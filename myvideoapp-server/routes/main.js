const router = require('express').Router();
const uuidv4 = require('uuid').v4;
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('ffmpeg');
const { Worker } = require("worker_threads");

const uploadCheck = multer({
    storage: multer.diskStorage({
        destination: './temp/',
        filename: function(req, file, cb) {
            let ext = file.originalname.match(/\.([a-zA-Z0-9]*)$/)[1];
            cb( null, uuidv4().split("-").join("") + "." + ext);
        }
    })
});

router.post('/upload', uploadCheck.single('video'), async (req, res, next) => {
    try {
        const body = req.body;
        let fileInfo = path.parse(req.file.filename);
        const origFile = {
            name: fileInfo.base,
            loc: './temp/' + fileInfo.base
        }
        const title = req.body.title;
        console.log(fileInfo, origFile, title);
        let transcodeInfo = await videoTranscodePreCheck(fileInfo, origFile, title, body);
        return res.json(transcodeInfo);
    } catch (err) {
        console.log(err);
    }
});

router.get('/hello', (req, res, next) => {
    let a = "Hello from your Video Application Service";
    console.log(a);
    return res.json(a);
});

const resolutions = [2048, 1440, 1080, 720, 480, 360, 240];
const audioCodecs = ["aac", "ac3", "als", "sls", "mp3", "mp2", "mp1", "celp", "hvxc", "pcm_s16le"];
const supportedContainers = ["mov", "3gpp", "mp4", "avi", "flv", "webm", "mpegts", "wmv", "matroska"];
Object.freeze(resolutions); Object.freeze(audioCodecs); Object.freeze(supportedContainers);

const videoTranscodePreCheck = async (fileInfo, origFile, title, body) => {
    let process = new ffmpeg(origFile.loc); // ffmpeg module will begin ffmpeg process
    process.then(async function(video) {
        // If file is MOV, 3GPP, AVI, FLV, MPEG4, WebM or WMV continue, else send response download "Please upload video of type ..
        var resolution = video.metadata.video.resolution.h;
        var container = video.metadata.video.container.toLowerCase();
        console.log(video.metadata.video);
        if (supportedContainers.indexOf(container) >= 0) { // Work within the bounds of containers ffmpeg supports
            if (resolution >= 240) { // Work at a reasonably sized resolution
                var room = fileInfo.name // A room we can use as a socket id to communicate with the client
                for (let i = 0; i < resolutions.length; i++) { 
                    // Here we determine the highest resolution to transcode at
                    if (resolution == resolutions[i] || resolution > resolutions[i]) {
                        // This will be data primarily related to the video itself
                        var videoData = {
                            id: room,
                            startTime: new Date().getTime(),
                            title: title,
                            state: "processing",
                            file: fileInfo,
                            orig: origFile
                        }
                        // This will be more dynamic data related to the job itself
                        var jobData = {
                            i: i,
                            objUrls: [],
                            file: fileInfo,
                            orig: origFile,
                            encodeAudio: true,
                            room: room
                        }
                        const worker = new Worker("./jobs/video.js", { workerData: { videoData: videoData, jobData: jobData }}); // Start job
                        if (worker) {
                            return videoData; // We only do this once as to find the highest resolution to start from
                        } else {
                            throw new Error("Error starting job");
                        }
                    }
                }
            } else {
                throw new Error("Video resolution size too small");
                // TODO file delete method
            }
        } else {
            throw new Error("Video container not supported");
            // TODO file delete method
        }
    })
    .catch((error) => {
        // TODO file delete method
        console.log(error);
        return error;
    })
}

router.get('/getvideos', async (req, res, next) => {
    fs.readFile('./logs.txt',  'utf8', (err, data) => {
        d = data.split('\r\n');
        return res.json(d);
    });
});

module.exports = router;