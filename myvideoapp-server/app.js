'use strict';

const path = require('path');
const http = require('http');
const hostname = "127.0.0.1";
const port = 3000;

const express = require('express');
const app = express();
const main = require('./routes/main.js');
const bodyParser = require('body-parser');

const server = http.createServer(app);

// parse incoming requests as json and make it accessible from req body property.
app.use(bodyParser.json({
    type: function(req) {
        if (req.get('content-type')) {
            return req.get('content-type').indexOf('multipart/form-data') !== 0;
        } else {
            return true; // default if req.get('content-type') is bad
        }
    },
    limit: "50mb" // Set higher body parser limit for size of video objects
}));
app.use(bodyParser.urlencoded({ extended: false }));

// Add headers
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', "*");
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept'); // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Credentials', true); // Set to true if you need the website to include cookies in the requests sent to the API
    next();
});

app.use('/m/', main);

app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.json({
        error: err.message,
        type: err.type
    });
    console.log(err);
});

server.setTimeout(10*60*1000);
server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}`);
});