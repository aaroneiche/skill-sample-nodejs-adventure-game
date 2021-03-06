'use strict';

const Alexa = require('alexa-sdk');
const story = 'NorthPoleAdventure.html';
const TableName = null // story.replace('.html','').replace(/\s/g, "-");
var $twine = null;
const linksRegex = /\[\[([^\|\]]*)\|?([^\]]*)\]\]/g;

var debug = false;


module.exports.handler = (event, context, callback) => {
  if(debug) console.log(`handler: ${JSON.stringify(event.request)}`);

  // read the Twine 2 (Harlowe) story into JSON
  var fs = require('fs');
  var contents = fs.readFileSync(story, 'utf8');
  var m = contents.match(/<tw-storydata [\s\S]*<\/tw-storydata>/g);
  var xml = m[0];
  // because Twine xml has an attribute with no value
  xml = xml.replace('hidden>', 'hidden="true">');
  var parseString = require('xml2js').parseString;
  parseString(xml, function(err, result) {
    $twine = result['tw-storydata']['tw-passagedata'];
  });

  // prepare alexa-sdk
  const alexa = Alexa.handler(event, context);
  // APP_ID is your skill id which can be found in the Amazon developer console
  // where you create the skill. Optionally set as a Lamba environment variable.
  alexa.appId = process.env.APP_ID;
  alexa.dynamoDBTableName = TableName;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': function() {
    console.log(`LaunchRequest`);
    if (this.event.session.attributes['room'] !== undefined) {
      var room = currentRoom(this.event);
      var speechOutput = `Hello, you were playing before and got to the room called ${room['$']['name']}. Would you like to resume? `;
      var reprompt = `Say, resume game, or, new game.`;
      speechOutput = speechOutput + reprompt;
      var cardTitle = `Restart`;
      var cardContent = speechOutput;
      var imageObj = undefined;
      console.log(`LaunchRequest: ${JSON.stringify({
        "speak": speechOutput,
        "listen": reprompt,
        "card" : {
          "title": cardTitle,
          "content": cardContent,
          "imageObj": imageObj
        }
      })}`);
      this.response.speak(speechOutput)
        .listen(reprompt)
        .cardRenderer(cardTitle, cardContent, imageObj);
      this.emit(':responseReady');
    } else {
      this.emit('WhereAmI');
    }
  },
  'ResumeGame': function() {
    console.log(`ResumeGame:`);
    this.emit('WhereAmI');
  },
  'RestartGame': function() {
    console.log(`RestartGame:`);
    // clear session attributes
    this.event.session.attributes['room'] = undefined;
    this.event.session.attributes['visited'] = [];
    this.event.session.attributes['inventory'] = [];
    this.event.session.attributes['progress'] =[];
    this.emit('WhereAmI');
  },
  'WhereAmI': function(longtext) {
    var speechOutput = "";
    if (this.event.session.attributes['room'] === undefined) {
      // you just started so you are in the first room
      this.event.session.attributes['room'] = $twine[0]['$']['pid'];
      this.event.session.attributes['inventory'] = [];
      this.event.session.attributes['progress'] =[];

      speechOutput = `Welcome to ${story.replace('.html','')}. Lets start your game. `;
    }

    var room = currentRoom(this.event);
    console.log(`WhereAmI: in ${JSON.stringify(room)}`);

    let inventory = inventoryNames(this.event);
    
    //Remove if blocks from text
    var displayableText = parseIf(room['_'],inventory.concat(this.event.session.attributes.progress));
    
    //Remove use blocks from text
    displayableText = parseUse(displayableText)[0];

    linksRegex.lastIndex = 0;
    let m;
    while ((m = linksRegex.exec(displayableText)) !== null) {
      displayableText = displayableText.replace(m[0], m[1]);
      linksRegex.lastIndex = 0;
    }
    // strip html
    displayableText = displayableText.replace(/<\/?[^>]+(>|$)/g, "");
    displayableText = displayableText.replace("&amp;", "and");
    speechOutput = speechOutput + displayableText;

    // create reprompt from links: "You can go north or go south"
    var reprompt = "";
    linksRegex.lastIndex = 0;
    while ((m = linksRegex.exec(room['_'])) !== null) {
      if (m.index === linksRegex.lastIndex) {
        linksRegex.lastIndex++;
      }
      if (reprompt === "") {
        if (!m[1].toLowerCase().startsWith('if you')) {
          reprompt = "You can";
        }
      } else {
        reprompt = `${reprompt} or`;
      }
      reprompt = `${reprompt} ${m[1]}`;
    }

    var firstSentence = displayableText.split('.')[0];
    var lastSentence = displayableText.replace('\n',' ').split('. ').pop();
    var reducedContent = `${firstSentence}. ${reprompt}.`;

    // say less if you've been here before
    console.log(longtext);
    if (this.event.session.attributes['visited'] === undefined) {
      this.event.session.attributes['visited'] = [];
    }
    if (this.event.session.attributes['visited'].includes(room['$']['pid'])) {
      console.log(`WhereAmI: player is revisiting`);
      // speechOutput = reducedContent;
    } else {
      this.event.session.attributes['visited'].push(room['$']['pid']);
    }

    var cardTitle = firstSentence;
    var cardContent = (reprompt > '') ? reprompt : lastSentence;
    var imageObj = undefined;

    console.log(`WhereAmI: ${JSON.stringify({
      "speak": speechOutput,
      "listen": reprompt,
      "card" : {
        "title": cardTitle,
        "content": cardContent,
        "imageObj": imageObj
      }
    })}`);
    linksRegex.lastIndex = 0;
    if (linksRegex.exec(room['_'])) {
      // room has links leading out, so listen for further user input
      this.response.speak(speechOutput)
        .listen(reprompt)
        .cardRenderer(cardTitle, cardContent, imageObj);
    } else {
      console.log(`WhereAmI: at the end of a branch. Game over.`);
      // clear session attributes
      this.event.session.attributes['room'] = undefined;
      this.event.session.attributes['visited'] = [];
      this.response.speak(speechOutput)
        .cardRenderer(cardTitle, cardContent, imageObj);
    }
    this.emit(':responseReady');
  },
  'Get': function() {
    var slotValues = getSlotValues(this.event.request.intent.slots);
    let passage= followLink(this.event, [slotValues['object_name']['resolved']]);
    
    var speechOutput = "You can't get that"
    var cardTitle = "Trying to get " + slotValues['object_name']['resolved'];
    var cardContent = speechOutput;

    console.log("Trying to get " + slotValues['object_name']['resolved']);
    
    if(inventoryNames(this.event).indexOf(slotValues['object_name']['resolved']) > -1){
      //You already have that.
      console.log("Already in inventory");
      speechOutput = "You already have that.";
      cardContent = "In your inventory";
    }
    else if(passage!= undefined && passage!= false && passage['$'].tags.indexOf("gettable") > -1){
      //That's gettable
      console.log("Exists and Gettable");
      
      //add to inventory.
      this.event.session.attributes['inventory'].push(passage);
      speechOutput = "You get the " + slotValues['object_name']['resolved'];
      cardContent = speechOutput;  
    }

    this.response.speak(speechOutput)
      .listen()
      .cardRenderer(cardTitle, cardContent); //, imageObj
    this.emit(':responseReady');
  },
  'Go': function() {
    console.log(`Go`);
    var slotValues = getSlotValues(this.event.request.intent.slots);
    var new_passage = followLink(this.event, slotValues['location']['resolved']);
    if(new_passage != undefined && new_passage['$'].tags.indexOf("place") > -1) {
      this.event.session.attributes['room'] = new_passage['$'].pid;
      this.emit('WhereAmI');
    }else{
      //can't go there.
      var speechOutput = "Sorry, you can't go there.";
      var cardTitle = speechOutput;
      var cardContent = "Try something else";

      // roomTextOb = roomText(this.event);

      this.response.speak(speechOutput)
        .listen("What would you like to do?")
        .cardRenderer(cardTitle, cardContent);
    }
  },
  'Use': function(){
    // Use _object_ on _subject_
    var slotValues = getSlotValues(this.event.request.intent.slots);
    
    //First check that you have object
    var hasObject = (inventoryNames(this.event).indexOf(slotValues.object.resolved.toLowerCase()) > -1);

    //Next check that subject is accessible from here
    var subject = followLink(this.event, slotValues['subject']['resolved']);
    var subjectHere = (subject != undefined && subject['$'].tags.indexOf("usable") > -1 )

    var speechOutput;
    var cardTitle;
    var cardContent;

    var hasEnd = false;

    if(hasObject == false){
      //Say that you don't have it.
      speechOutput = "You don't have " + slotValues.object.resolved + " in your inventory";
      cardTitle = "Don't have that";
      cardContent = speechOutput;
    }else if(subjectHere == false){
      //say that that's not here.
      speechOutput = slotValues.subject.resolved + " isn't here.";
      cardTitle = "Not here";
      cardContent = speechOutput;
    }else{
      var usage = parseUse(subject["_"], slotValues.object.resolved);
      
      //check if this is the end of the game.
      hasEnd = parseEndgame(usage[1]);

      speechOutput = usage[1]; //TODO: Add whereami text to speech after explaining.

      cardTitle = "You use " + slotValues.object.resolved;
      cardContent = speechOutput;
    
      setProgress(this.event,slotValues.subject.resolved + "_" + slotValues.object.resolved.replace(" ","_"));
    }

    var roomTextData = roomText(this.event);
    // console.log(roomTextData);

    // "displayableText": displayableText,
    // "reducedText": reducedContent,
    // "reprompt": reprompt,
    // "cardTitle": cardTitle,
    // "cardContent": cardContent
    
    //Get the text from subject 
    if(hasEnd){
      speechOutput = speechOutput.replace("<<endgame>>","");
      this.response.speak(speechOutput)
      .cardRenderer(roomTextData.cardTitle, roomTextData.cardContent);
      this.emit(":responseReady");
    }else{
      this.response.speak(speechOutput)
      .listen(roomTextData.reprompt)
      .cardRenderer(roomTextData.cardTitle, roomTextData.cardContent);
      this.emit(":responseReady");
    }
       
  },
  'Look': function() {
    // get the full room text,
    
    var subject = {};

    var slotValues = getSlotValues(this.event.request.intent.slots);
    if(slotValues.target.resolved != undefined){
      subject = getPassageText(this.event, slotValues.target.resolved);
      
      //We tried looking, but didn't find aynthing
      if(subject == undefined){
        subject = {
          "displayableText": "You don't see anything",
          "reducedText": "You don't see anything",
          "reprompt": "You don't see anything",
          "cardTitle": "Looking",
          "cardContent": "You don't see anything"
        }
      }

    }else{
      //Just look here.
      subject = roomText(this.event);
    }

      
    this.response.speak(subject.displayableText)
    .listen("What would you like to do?")
    .cardRenderer(subject.cardTitle, subject.cardContent);
    this.emit(":responseReady");
  },
  'AMAZON.HelpIntent': function() {
    var speechOutput = 'This is the North Pole Adventure game';
    var reprompt = `You can say things like Go to house, or get key, or use key on door. 
    If you want to know where you are, you can say Look or Where am I?`;
    speechOutput = speechOutput + reprompt;
    var cardTitle = 'Help.';
    var cardContent = speechOutput;
    var imageObj = undefined;
    console.log(`HelpIntent: ${JSON.stringify({
      "speak": speechOutput,
      "listen": reprompt,
      "card" : {
        "title": cardTitle,
        "content": cardContent,
        "imageObj": imageObj
      }
    })}`);
    this.response.speak(speechOutput)
      .listen(reprompt)
      .cardRenderer(cardTitle, cardContent, imageObj);
    this.emit(':responseReady');
  },
  'AMAZON.CancelIntent': function() {
    this.emit('CompletelyExit');
  },
  'AMAZON.StopIntent': function() {
    this.emit('CompletelyExit');
  },
  'CompletelyExit': function() {
    var speechOutput = 'Goodbye.';
    if (TableName) {
      speechOutput = `Your progress has been saved. ${speechOutput}`;
    }
    var cardTitle = 'Exit.';
    var cardContent = speechOutput;
    var imageObj = undefined;
    console.log(`CompletelyExit: ${JSON.stringify({
      "speak": speechOutput,
      "listen": null,
      "card" : {
        "title": cardTitle,
        "content": cardContent,
        "imageObj": imageObj
      }
    })}`);
    this.response.speak(speechOutput)
      .cardRenderer(cardTitle, cardContent, imageObj);
    this.emit(':responseReady');
  },
  'AMAZON.RepeatIntent': function() {
    console.log(`RepeatIntent`);
    this.emit('WhereAmI');
  },
  'Unhandled': function() {
    // handle any intent in interaction model with no handler code
    console.log(`Unhandled`);
    var new_passage = followLink(this.event, this.event.request.intent.name);
    this.event.session.attributes['room'] = new_passage['$'].pid;
    this.emit('WhereAmI');
  },
  'SessionEndedRequest': function() {
    // "exit", timeout or error. Cannot send back a response
    console.log(`Session ended: ${this.event.request.reason}`);
  }
};

function currentRoom(event) {
  var currentRoomData = undefined;
  for (var i = 0; i < $twine.length; i++) {
    if ($twine[i]['$']['pid'] === event.session.attributes['room']) {
      currentRoomData = $twine[i];
      break;
    }
  }
  return currentRoomData;
}

function followLink(event, direction_or_array) {
  var directions = [];
  if (direction_or_array instanceof Array) {
    directions = direction_or_array;
  } else {
    directions = [direction_or_array];
  }
  
  var room = currentRoom(event);
  var result = undefined;
  var result_passage = undefined;

  directions.every(function(direction, index, _arr) {
    if(debug) console.log(`followLink: try '${direction}' from ${room['$']['name']}`);
    var directionRegex = new RegExp(`.*${direction}.*`, 'i');
    let links;
    
    linksRegex.lastIndex = 0;
    while ((links = linksRegex.exec(room['_'])) !== null) {
      if (links.index === linksRegex.lastIndex) {
        linksRegex.lastIndex++;
      }
      result = links[1].match(directionRegex);
      var target = links[2] || links[1];
      if(debug) console.log(`followLink: check ${links[1]} (${target}) for ${direction} => ${result} `);
      if (result) {
        if(debug) console.log(`followLink: That would be ${target}`);
        for (var i = 0; i < $twine.length; i++) {
          if ($twine[i]['$']['name'].toLowerCase() === target.toLowerCase()) {
            result_passage = $twine[i]; //return the found passage.
            break;
          }
        }
        break;
      }
    }
    return !result;
  });
  
  return result_passage;
}

//COOKBOOK HELPER FUNCTIONS

function getSlotValues(filledSlots) {
  //given event.request.intent.slots, a slots values object so you have
  //what synonym the person said - .synonym
  //what that resolved to - .resolved
  //and if it's a word that is in your slot values - .isValidated
  let slotValues = {};

  if(debug) console.log('The filled slots: ' + JSON.stringify(filledSlots));
  Object.keys(filledSlots).forEach(function(item) {
    //console.log("item in filledSlots: "+JSON.stringify(filledSlots[item]));
    var name = filledSlots[item].name;
    //console.log("name: "+name);
    if (filledSlots[item] &&
      filledSlots[item].resolutions &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0] &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0].status &&
      filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {

      switch (filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
        case "ER_SUCCESS_MATCH":
          slotValues[name] = {
            "synonym": filledSlots[item].value,
            "resolved": filledSlots[item].resolutions.resolutionsPerAuthority[0].values[0].value.name,
            "isValidated": true
          };
          break;
        case "ER_SUCCESS_NO_MATCH":
          slotValues[name] = {
            "synonym": filledSlots[item].value,
            "resolved": filledSlots[item].value,
            "isValidated": false
          };
          break;
      }
    } else {
      slotValues[name] = {
        "synonym": filledSlots[item].value,
        "resolved": filledSlots[item].value,
        "isValidated": false
      };
    }
  }, this);
  //console.log("slot values: " + JSON.stringify(slotValues));
  return slotValues;
}

//Parses and includes if blocks in text.
function parseIf(inputText,gameVars) {
  var findIfRegex =  /(<<if (\!?\w+?)>>[\s\S]+?<<endif>>)/g;
  var parseIfRegex = /(<<if (\!?\w+?)>>([\s\S]+?)<<endif>>)/;

  //First, find all of the if statements in the block.
  var matchIf = inputText.match(findIfRegex);

  if(matchIf != null) {
    
    //Check if the if variable is true or false
    matchIf.forEach(match => {
      var m = match.match(parseIfRegex);
      var original = m[1];
      
      //The property we're testing against
      var prop = (m[2].substring(0,1) != "!") ? m[2] : m[2].substring(1); 
      //whether we're checking to see if we have (done) it or not.
      var negate = m[2].substring(0,1) == "!";
      //The text enclosed in the if statement.
      var text = m[3];

      if(gameVars.indexOf(prop) != -1 && negate == false || gameVars.indexOf(prop) == -1 && negate == true){
        //insert the text
        inputText = inputText.replace(m[1],text);
      }else{
        //remove the text
        inputText = inputText.replace(m[1],"");
      }
      
    });
    
  }
  return inputText;
}

// Parses the text for use blocks, returns the text with no use blocks
// and the use action text if the use object is found.
function parseUse(inputText, object) {
  var term = (object == undefined)?  "" : object.replace(" ","_");
  var useMatch = new RegExp("<<use " + term + ">>([\\s\\S]+?)<<enduse>>","gim");
  var useBlockRegex = /<<use (.+?)>>[\s\S]+?<<enduse>>/gim; 

  //If there's a matching use block in here, this will return the action text
  var useObjectText = useMatch.exec(inputText);

  //We'll remove all the use blocks here so they're not in the output text.
  var cleanText = inputText.replace(useBlockRegex,""); 

  //Return the clean text, and the usage text, if it exists
  return [cleanText, ((useObjectText != null) ?useObjectText[1] : null)];
}

function parseEndgame(inputText) {
  var search = /<<endgame>>/g;
  inputText = (inputText != null) ? inputText : ""
  return inputText.match(search) != null;
}

//returns an array of names in inventory
function inventoryNames(event){
  return event.session.attributes['inventory'].map(o=>{
    return o['$'].name.toLowerCase();
  });
}

// Checks to see if a certain progress value has been accomplished.
// returns -1 if false, > 0 if true;
function checkProgress(event,progress_value){
  return event.session.attributes.progress.indexOf(progress_value);
}

//Sets a value in progress
function setProgress(event, progress_value) {
  if(event.session.attributes.progress.indexOf(progress_value) === -1){
    return event.session.attributes.progress.push(progress_value);
  }
  return true;
}


//Checks to see if this object is in your inventory.
//Returns the index of the item or -1.
function checkInventory(objectName,inventory) {
  
  //Assume we won't find it.
  var objectIndex = -1;
  inventory.forEach((o,i)=>{
    if(objectName === o['$'].name){
      objectIndex = i;
    }
  });
  return objectIndex;
}

function roomText(event) {
  var room = currentRoom(event);
  
  let inventory = inventoryNames(event);
  let progress = event.session.attributes.progress

  //Remove if blocks from text - passes in inventory + progress;
  var displayableText = parseIf(room['_'],inventory.concat(progress));
  
  //Remove use blocks from text
  displayableText = parseUse(displayableText)[0];

  linksRegex.lastIndex = 0;
  let m;
  while ((m = linksRegex.exec(displayableText)) !== null) {
    displayableText = displayableText.replace(m[0], m[1]);
    linksRegex.lastIndex = 0;
  }
  // strip html
  displayableText = displayableText.replace(/<\/?[^>]+(>|$)/g, "");
  displayableText = displayableText.replace("&amp;", "and");

  var firstSentence = displayableText.split('.')[0];
  var lastSentence = displayableText.replace('\n',' ').split('. ').pop();
  var reducedContent = `${firstSentence}.`;

  var cardTitle = firstSentence;
    var imageObj = undefined;

  linksRegex.lastIndex = 0;

  return {
    "displayableText": displayableText,
    "reducedText": lastSentence,
    "reprompt": lastSentence,
    "cardTitle": cardTitle,
    "cardContent": lastSentence
  }
}

//Like roomText (which will be deprecated) but works for given passage name.
function getPassageText(event,passageName) {

  //Get the passage data for this passage, relative to our location
  var p = followLink(event, passageName);

  //passage is invalid
  if(p == undefined) {
    return undefined;
  }

  // var room = currentRoom(event);
  var passageText = p['_'];
  
  let inventory = inventoryNames(event);
  let progress = event.session.attributes.progress

  //Remove if blocks from text - passes in inventory + progress;
  var displayableText = parseIf(passageText,inventory.concat(progress));
  
  //Remove use blocks from text
  displayableText = parseUse(displayableText)[0];

  linksRegex.lastIndex = 0;
  let m;
  while ((m = linksRegex.exec(displayableText)) !== null) {
    displayableText = displayableText.replace(m[0], m[1]);
    linksRegex.lastIndex = 0;
  }
  // strip html
  displayableText = displayableText.replace(/<\/?[^>]+(>|$)/g, "");
  displayableText = displayableText.replace("&amp;", "and");

  var firstSentence = displayableText.split('.')[0];
  var lastSentence = displayableText.replace('\n',' ').split('. ').pop();
  var reducedContent = `${firstSentence}.`;

  var cardTitle = firstSentence;
    var imageObj = undefined;

  linksRegex.lastIndex = 0;

  return {
    "displayableText": displayableText,
    "reducedText": lastSentence,
    "reprompt": lastSentence,
    "cardTitle": cardTitle,
    "cardContent": lastSentence
  }
}