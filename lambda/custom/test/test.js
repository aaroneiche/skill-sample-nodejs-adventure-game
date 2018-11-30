const lambdaLocal = require('lambda-local');
const path = require('path');
var mocha = require('mocha');
var chai = require('chai');
var should = chai.should();

var use = require('./event_use.json');
 

describe("Tests the Use function",function(){

    it("Tests using Water on Dasher", function() {

        var event_data = require('./event_generic.json');
        
        //Set the Object to 'robot'
        event_data.request.intent.slots.object.value = "robot"
        event_data.request.intent.slots.object.resolutions.resolutionsPerAuthority[0].values[0].value.name = "robot"

        console.log(event_data.request.intent);

        lambdaLocal.execute({
            event: event_data,
            lambdaPath: path.join(__dirname, '../index.js'),
            timeoutMs: 3000
        }).then(function(response) {
            // console.log(response);
            response.response.card.title.should.equal("You use water");
            done();
            
        }).catch(function(err) {
            console.log(err);
        });
    })
})

