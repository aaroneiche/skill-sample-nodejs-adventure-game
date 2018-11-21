'use strict';

const Alexa = require('alexa-sdk');
const story = 'NorthPoleAdventure.html';
const TableName = null // story.replace('.html','').replace(/\s/g, "-");
var $twine = null;
const linksRegex = /\[\[([^\|\]]*)\|?([^\]]*)\]\]/g;

module.exports.handler = (event, context, callback) => {
  console.log(`handler: ${JSON.stringify(event.request)}`);

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
    this.emit('WhereAmI');
  },
  'WhereAmI': function() {
    var speechOutput = "";
    if (this.event.session.attributes['room'] === undefined) {
      // you just started so you are in the first room
      this.event.session.attributes['room'] = $twine[0]['$']['pid'];
      this.event.session.attributes['inventory'] = [];

      speechOutput = `Welcome to ${story.replace('.html','')}. Lets start your game. `;
    }

    var room = currentRoom(this.event);
    console.log(`WhereAmI: in ${JSON.stringify(room)}`);

    // get displayable text
    // e.g "You are here. [[Go South|The Hall]]" -> "You are here. Go South"
    // var displayableText = room['_'];

    //Remove collectable items from the description of the room. 
    var objectRegex = /\$\w+/g;
    var itemMatches = room['_'].match(objectRegex);
    var displayableText = room['_'].replace(objectRegex,"");

    displayableText = parseIf(room['_'],this.event.session.attributes['inventory']);
    // console.log(displayableText);

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
    let p = followLink(this.event, [slotValues['object_name']['resolved']])
    
    var speechOutput = "You can't get that"
    var cardTitle = "Trying to get " + slotValues['object_name']['resolved'];
    var cardContent = speechOutput;

    var iKey = checkInventory(slotValues['object_name']['resolved'],
                  this.event.session.attributes['inventory']);

    console.log("Trying to get");

    if(iKey > -1){
      //You already have that.
      console.log("Already in inventory");
      speechOutput = "You already have that.";
      cardContent = "In your inventory";
    }
    else if(p != undefined && p != false && p['$'].tags.indexOf("gettable") > -1){
      //That's gettable
      console.log("Exists and Gettable");
      
      //add to inventory.
      this.event.session.attributes['inventory'].push(p);
      speechOutput = "You got " + slotValues['object_name']['resolved'];
      cardContent = speechOutput;  
    }
    
    this.response.speak(speechOutput)
      .listen()
      .cardRenderer(cardTitle, cardContent); //, imageObj
    this.emit(':responseReady');
  },
  // 'Go': function() {
  //   console.log(`Go`);
  //   var slotValues = getSlotValues(this.event.request.intent.slots);
  //   followLink(this.event, [slotValues['direction']['resolved'], slotValues['direction']['synonym']]);
  //   this.emit('WhereAmI');
  // },
  // 'Page': function() {
  //   // old-school cyoa: "to go south turn to page 20"..you say, "page 20"
  //   console.log(`Page`);
  //   followLink(this.event, this.event.request.intent.slots.number.value);
  //   this.emit('WhereAmI');
  // },
  // 'Fight': function() {
  //   console.log(`Fight`);
  //   followLink(this.event, [this.event.request.intent.slots.npc.value, 'fight']);
  //   this.emit('WhereAmI');
  // },
  'AMAZON.HelpIntent': function() {
    var speechOutput = 'This is the Sample Gamebook Skill. ';
    var reprompt = 'Say where am I, to hear me speak.';
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

//Checks to see if the requested link exists.
// function getPassage(event, direction_or_array) {
//   var directions = [];
//   if (direction_or_array instanceof Array) {
//     directions = direction_or_array;
//   } else {
//     directions = [direction_or_array];
//   }

//   console.log(directions);

//   var room = currentRoom(event);
//   var result = undefined;
//   directions.every(function(direction, index, _arr) {
//     console.log(`getPassage: try '${direction}' from ${room['$']['name']}`);
//     var directionRegex = new RegExp(`.*${direction}.*`, 'i');
//     let links;
//     linksRegex.lastIndex = 0;
//     while ((links = linksRegex.exec(room['_'])) !== null) {
//       if (links.index === linksRegex.lastIndex) {
//         linksRegex.lastIndex++;
//       }
//       result = links[1].match(directionRegex);
//       var target = links[2] || links[1];
//       console.log(`getPassage: check ${links[1]} (${target}) for ${direction} => ${result} `);
//       if (result) {
//         console.log(`getPassage: That would be ${target}`);
//         for (var i = 0; i < $twine.length; i++) {
//           if ($twine[i]['$']['name'].toLowerCase() === target.toLowerCase()) {
//             return $twine[i]['$'];
//             // event.session.attributes['room'] = $twine[i]['$']['pid'];
//             break;
//           }
//         }
//         break;
//       }
//     }
//     return !result;
//   });
// }

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
    console.log(`followLink: try '${direction}' from ${room['$']['name']}`);
    var directionRegex = new RegExp(`.*${direction}.*`, 'i');
    let links;
    
    linksRegex.lastIndex = 0;
    while ((links = linksRegex.exec(room['_'])) !== null) {
      if (links.index === linksRegex.lastIndex) {
        linksRegex.lastIndex++;
      }
      result = links[1].match(directionRegex);
      var target = links[2] || links[1];
      console.log(`followLink: check ${links[1]} (${target}) for ${direction} => ${result} `);
      if (result) {
        console.log(`followLink: That would be ${target}`);
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

  console.log('The filled slots: ' + JSON.stringify(filledSlots));
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

//parses and includes if blocks in text.
function parseIf(inputText,gameVars) {
  var findIf = /(<<if (\!?\w+?)>>.+?<<endif>>)/g;
  var parseIf = /(<<if (\!?\w+?)>>(.+?)<<endif>>)/;

  var matchIf = inputText.match(findIf);

  if(matchIf != null) {
    
    //Check if the if variable is true or false
    matchIf.forEach(match => {
      var m = match.match(parseIf);
      var original = m[1];
      var prop = (m[2].substring(0,1) != "!") ? m[2] : m[2].substring(1); 
      var negate = m[2].substring(0,1) == "!";
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