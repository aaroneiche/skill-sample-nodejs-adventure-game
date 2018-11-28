const lambdaLocal = require('lambda-local');
const path = require('path');

var use = require('./event_use.json');
 
lambdaLocal.execute({
    event: use,
    lambdaPath: path.join(__dirname, '../index.js'),
    timeoutMs: 3000
}).then(function(done) {
    console.log(done);
}).catch(function(err) {
    console.log(err);
});