const wa = require('@open-wa/wa-automate');
const mime = require('mime-types');
const fs = require('fs');
const { exec } = require("child_process");
const { Configuration, OpenAIApi } = require("openai");

require('dotenv').config();
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const path_mp3 = process.env.PATH_MP3 ? process.env.PATH_MP3 : '.' ;
const sessionDataPath = process.env.PATH_SESSION ? process.env.PATH_SESSION : './' ;
const groups = process.env.GROUPS ? process.env.GROUPS : '' ;
const allowedGroups = groups.split(',');
const use_openai_api = process.env.OPENAI_API_KEY != '';

console.log(`Will transcribe audio messages from these groups = ${allowedGroups}`);

wa.create({
    useChrome: true,
    sessionId: "WhatsAppTranscription",
    multiDevice: true, //required to enable multiDevice support
    authTimeout: 60, //wait only 60 seconds to get a connection with the host account device
    blockCrashLogs: true,
    disableSpins: true,
    headless: true,
    hostNotificationLang: 'PT_BR',
    logConsole: true,
    popup: true,
    qrTimeout: 0, //0 means it will wait forever for you to scan the qr code
    sessionDataPath,
}).then(client => start(client));

function start(client) {
    client.onAnyMessage(async message => {
        {
            const d = new Date(message.t * 1000).toISOString();
            const orig = message.notifyName;
            const dest = message.chat.contact.name;
            const isGroup = (message.isGroupMsg === true)? "(GROUP)": "";
            const msg = message.body;
            const isAudio = (message.mimetype && message.mimetype.includes("audio")) ? "(AUDIO)": "";
            console.log(`${d}|${orig}|${dest}${isGroup}|${msg}${isAudio}`);

            const stringified = JSON.stringify(message, null, 4);
            fs.appendFile("message.log", `${d}|message = ${stringified}\n`, async function (err) {
                if (err) {
                    return console.log("Failed to log message", err);
                }
            });
        }
        // console.log(message);

        if (((allowedGroups.indexOf(message.chatId) !== -1) || message.isGroupMsg === false) && message.mimetype && message.mimetype.includes("audio")) {
            const filename = `${path_mp3}/${message.t}.${mime.extension(message.mimetype)}`;
            const mediaData = await wa.decryptMedia(message);

            fs.writeFile(filename, mediaData, async function (err) {
                if (err) {
                    return console.log(err);
                }
                console.log('The file was saved!');

                //console.log(`stdout: ${stdout}`);
                if(use_openai_api) {
                    // convert to wav
                    exec(`ffmpeg -v 0 -i ${filename} -acodec libmp3lame ${filename}.mp3`, async (error, stdout, stderr) => {
                        if (error) {
                            console.log(`error: ${error.message}`);
                            return;
                        }
                        if (stderr) {
                            console.log(`stderr: ${stderr}`);
                            return;
                        }
                        // call OpenAI's API
                        const resp = await openai.createTranscription(
                            fs.createReadStream(`${filename}.mp3`),
                            "whisper-1"
                        );
                        client.reply(message.chatId, `🗣️ \`\`\`${resp.data.text}\`\`\``, message.id);
                    }); //exec ffmpeg
                } else {
                    // using whisper.cpp
                    // If you have whisper install and want to use it locally instead of through the API
                    // you can do something like this:

                    // whisper.cpp requires a 16KHz PCM WAV file
                    exec(`ffmpeg -v 0 -i ${filename} -ar 16000 ${filename}.wav`, async (error, stdout, stderr) => {
                        if (error) {
                            console.log(`error: ${error.message}`);
                            return;
                        }
                        if (stderr) {
                            console.log(`stderr: ${stderr}`);
                            return;
                        }
    
                        exec(`./whisper -otxt --model ggml-small.bin -l pt ${filename}.wav`, (error, stdout, stderr) => {
                            if (error) {
                                console.log(`error: ${error.message}`);
                            }
                            if (stderr) {
                                console.log(`stderr: ${stderr}`);
                            }

                            console.log(`stdout: ${stdout}`);

                            fs.readFile(`${filename}.wav.txt`, 'utf8', (err, data) => {
                                if (err) throw err;
                                console.log("Getting transcription:");
                                console.log(data);
                                client.reply(message.chatId, `🗣️ \`\`\`${data}\`\`\``, message.id);
                            });
                        }); //exec whisper
                    }); //exec ffpmpeg

                }
            });

        }

    });
}
