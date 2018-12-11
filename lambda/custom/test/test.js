const lambdaLocal = require('lambda-local');
const path = require('path');
var mocha = require('mocha');
var chai = require('chai');
var should = chai.should();

var use = require('./event_use.json');
 
describe("Tests the Use function",function(){

    it("Tests using Water on Dasher", function() {

        var event_data = require('./event_use.json');

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

describe("Tests the Get function",function(){

    it("Tests getting Water from shed", function() {

        var event_data = require('./event_get.json');

        lambdaLocal.execute({
            event: event_data,
            lambdaPath: path.join(__dirname, '../index.js'),
            timeoutMs: 3000
        }).then(function(response) {
            // console.log(response);
            // response.response.card.title.should.equal("You use water");
            done();
            
        }).catch(function(err) {
            console.log(err);
        });
    })
})


// describe("Tests the Room Text function",function(){

//     it("Tests Shed Room", function() {

//         var event_data = require('./event.json');

//         lambdaLocal.execute({
//             event: event_data,
//             lambdaPath: path.join(__dirname, '../index.js'),
//             timeoutMs: 3000
//         }).then(function(response) {
//             // console.log(response);
//             // response.response.card.title.should.equal("You use water");
//             done();
            
//         }).catch(function(err) {
//             console.log(err);
//         });
//     })
// })
