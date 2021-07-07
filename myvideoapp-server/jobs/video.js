// Video.js file

const { parentPort, workerData } = require("worker_threads");
const ffmpeg = require("ffmpeg");
const aws = require("aws-sdk");
aws.config.update({
    accessKeyId: 'XXXXXXXXXXXXXXXX',
    secretAccessKey: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    region:'us-east-2'
});
const s3 = new aws.S3();
const fs = require('fs');
const cp = require('child_process');
const resolutions = [2048, 1440, 1080, 720, 480, 360, 240];
const audioCodecs = ["aac", "ac3", "als", "sls", "mp3", "mp2", "mp1", "celp", "hvxc", "pcm_s16le"];
const supportedContainers = ["mov", "3gpp", "mp4", "avi", "flv", "webm", "mpegts", "wmv", "matroska"];
Object.freeze(resolutions); Object.freeze(audioCodecs); Object.freeze(supportedContainers);

/**
 * Function to recreate objects that are being passed by reference
 */
const createObj = (obj) => {
    let newObj = {};
    return Object.assign(newObj, obj);
}
/**
 * Arbitrary way of beginning the convertVideos process. If you have things to do before the process begins, do it here. Sending the video to a profanity detection algorithm, sending a socket update to the client, tell the app to start the kettle, whichever
 */
async function processSingleVideo(videoData, jobData) {
    return await convertVideos(videoData, jobData);
}

/**
 * Will recursively transcode 1 audio file and as many videos required regressing down from highest potential resolution
 */
async function convertVideos(videoData, jobData) {
    try {
        if (jobData.i < resolutions.length) { 
            let process = new ffmpeg(videoData.orig.loc, { maxBuffer: 512 * 1000 })
                .catch((err) => {
                    console.log(err);
                    return false;
                });
            if (jobData.encodeAudio) { // On first iteration encode audio
                if (process) {
                    process.then(async function(audio) {
                        const audioFormat = "mp4";
                        if (audioCodecs.indexOf(audio.metadata.audio.codec.toLowerCase()) >= 0) { // Determine if current audio codec is supported
                            let rawPath = "temp/" + videoData.id + "-audio" + "-raw" + "." + audioFormat;
                            audio.addCommand('-vn'); // Video none
                            audio.addCommand('-c:a', "aac"); // Convert all audio to aac, ensure consistency of format
                            audio.addCommand('-b:a', '256k'); 
                            if (audio.metadata.audio.channels.value == null || audio.metadata.audio.channels.value == 0) {
                                audio.addCommand('-ac', '6'); // If channels value is null or equal to 0, convert to surround sound
                            }
                            console.log(rawPath);
                            audio.save("./" + rawPath, async function (err, file) { // Creates audio file at path specified. Log file for path.
                                if (!err) {
                                    jobData.objUrls.push({
                                        "path" : rawPath,
                                        "detail" : "aac"
                                    });
                                    jobData.encodeAudio = false;
                                    return await convertVideos(videoData, jobData);
                                } else {
                                    // Delete all job data from objUrls
                                    return false;
                                }
                            });
                        } else {
                            return false;
                        }
                    })
                } else {
                    return false;
                }
            } else {
                if (process) {
                    process.then(async function(video) {
                        const videoFormat = "mp4";
                        let rawPath = "temp/" + videoData.id + "-" + resolutions[jobData.i] + "-raw" + "." + videoFormat;
                        video.setVideoSize("?x" + resolutions[jobData.i], true, true).setDisableAudio();
                        video.addCommand('-vcodec', 'libx264'); // Codec to use to convert  video
                        if (video.metadata.video.codec == "mpeg2video") {
                            video.addCommand('-preset', 'medium');
                        } else {
                            video.addCommand('-preset', 'faster');
                        }
                        video.addCommand('-crf', '24'); // Quality of transcode
                        video.addCommand('-tune', 'film'); // You can remove this if you like.
                        // There are many more commands for ffmpeg, please read FFmpeg npm module and FFmpeg official documentation
                        console.log(rawPath);
                        video.save("./" + rawPath, async function (err, file) { // Creates new file at path specified. Log file for file location
                            if (!err) {
                                jobData.objUrls.push({
                                    "path" : rawPath,
                                    "detail" : resolutions[jobData.i]
                                });
                                jobData.i += 1;
                                return await convertVideos(videoData, jobData);
                            } else {
                                console.log(err);
                                return false;
                            }
                        });
                    });
                } else {
                    return false;
                }
            }
        } else {
            makeMpd(videoData, jobData)
        }
    } catch (err) {
        return false;
    }
}

/**
 * Uses Shaka Packager to build the necessary Mpd and Hls files for Shaka Player to interpret for playback
 */
async function makeMpd(videoData, jobData) {
    try {
        let delArr = [];
        let rawObjUrls = [];
        for (let i = 0; i < jobData.objUrls.length; i++) { // Go through all uri's and create references in array to all raw obj uri's
            rawObjUrls[i] = createObj(jobData.objUrls[i]);
        }
        // All of below is to build the appropriate command to run in a child process. Packager will run and make the playlist files we tell it to in the command. You can do this however you like, just make sure to read Shaka Packager documentation and write a script to build the command you need. 
        let command = "packager";
        let args = "";
        let tempM3u8 = [];
        for (obj of jobData.objUrls) {
            let detail = obj.detail;
            let fileType = "";
            if (resolutions.toString().indexOf(obj.detail) >= 0) {
                fileType = "video";
            } else if (audioCodecs.toString().indexOf(obj.detail) >= 0) {
                fileType = "audio";
                detail = "audio";
            } else {
                fileType = "text";
            }
            args += "in=" + obj.path + ",stream=" + fileType + ",output=" + obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + ".mp4"; 
            args += ",playlist_name=" + obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + ".m3u8"; // HLS
            // All HLS functionality for both if conditions
            if (detail == "audio") { 
                args += ",hls_group_id=audio,hls_name=ENGLISH ";
                tempM3u8.push({ "path": obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + ".m3u8", "detail": "audio" });
            } else {
                args += ",iframe_playlist_name=" + obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + "_iframe.m3u8 ";
                tempM3u8.push({ "path": obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + ".m3u8", "detail": "video" });
                tempM3u8.push({ "path": obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + "_iframe.m3u8", "detail": "video" });
            }
            obj.path = obj.path.match(/([\/a-z0-9]*)-([a-z0-9]*)-([a-z]*)/)[1] + "-" + detail + ".mp4"; // Change the path to the object to reference for aws s3 transfer
        }
        jobData.objUrls = jobData.objUrls.concat(tempM3u8);
        tempM3u8 = null;
        const expectedMpdPath = jobData.objUrls[0].path.match(/([\/a-z0-9]*)-([a-z0-9]*)/)[1] + "-mpd.mpd"; // make expected mpd file string
        const expectedHlsPath = jobData.objUrls[0].path.match(/([\/a-z0-9]*)-([a-z0-9]*)/)[1] + "-hls.m3u8"; // make expected hls file string (iOS)
        args += "--mpd_output " + expectedMpdPath + " --hls_master_playlist_output " + expectedHlsPath;
        console.log(command + " " + args); 
        // Log above variables to see full child process command to be run
        let data = cp.exec(command + " " + args, {maxBuffer: 1024 * 8000}, async function(err, stdout, stderr) { // 8000kb max buffer, avoid fail
            if (err) {
                return false;
            } else {
                try {
                    if (fs.existsSync("./" + expectedMpdPath)) {
                        let mpdObj = { // This file will be used for Shaka Player for almost everything but iOS
                            "path" : expectedMpdPath,
                            "detail" : "mpd"
                        };
                        let hlsObj = { // This file will be used for Shaka Player for iOS
                            "path" : expectedHlsPath,
                            "detail" : "hls"
                        }
                        jobData.objUrls.push(mpdObj);
                        jobData.objUrls.push(hlsObj); 
                        jobData.objUrls = jobData.objUrls.concat(rawObjUrls);
                        await uploadToS3(videoData, jobData);
                    } else {
                        return false;
                    }
                } catch (err) {
                    return false;
                }
            }
        });
    } catch (err) {
        console.log(err);
        return false;
    }
}

/**
 * Uploads our files to AWS S3
 */
async function uploadToS3(videoData, jobData) {
    const keyRegex = /[a-z].*\/([a-z0-9].*)/; // Matches entire key
    const resoRegex = /-([a-z0-9].*)\./; // Matches the detail data at the end of the object key
    let s3Objects = [];
    let uploadData;
    for (let i = 0; i < jobData.objUrls.length; i++) {
        try {
            let data = fs.createReadStream(jobData.objUrls[i].path);
            uploadData = await s3.upload({ Bucket: 'shakatestbucket1', Key: jobData.objUrls[i].path.match(keyRegex)[1], Body: data }).promise();
            console.log(uploadData);
            if (await uploadData) { // Wait for data to be uploaded to S3
                s3Objects.push({location: uploadData.Location, detail: uploadData.Key.match(resoRegex)[1]});
            } else {
                return false;
            }
        } catch (err) {
            console.log(err);
            return false;
        }
    }
    // Append finished job id to our "database"
    fs.appendFile('logs.txt', videoData.id + "\r\n", function() { 
        deleteAllFiles(videoData, jobData);
    });
}

/**
 * Delete process files, clean directory
 */
async function deleteAllFiles(videoData, jobData) {
    fs.unlinkSync(jobData.orig.loc);
    let promises = jobData.objUrls.map(data => {
        return new Promise((resolve, reject) => {
            try {
                resolve(fs.unlinkSync(data.path));
            } catch (err) {
                reject(err);
            }
        })
    });
    let deletedData = await Promise.all(promises);
    console.log("Job Completed");
}

processSingleVideo(workerData.videoData, workerData.jobData);