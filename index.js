require('dotenv').config(); // Load environment variables from .env
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Use axios instead of fetch

// MongoDB connection URL
const mongoUrl = 'mongodb+srv://awtwhatsappcrashlog:hmTx4nNaxAeA9VNU@cluster0.qgmoc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const dbName = 'telegram_bot'; // Replace with your database name
let db;

// Connect to MongoDB
async function connectToMongoDB() {
    try {
        const client = new MongoClient(mongoUrl);
        await client.connect();
        db = client.db(dbName);
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        process.exit(1); // Exit if MongoDB connection fails
    }
}

// Function to log errors to MongoDB
async function logError(error, ctx = null) {
    if (!db) {
        console.error('Database not connected. Cannot log error.');
        return;
    }
    const errorsCollection = db.collection('errors');
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error.stack || error}`;
    const context = ctx ? {
        userId: ctx.from.id,
        command: ctx.message?.text || 'N/A',
    } : {};

    await errorsCollection.insertOne({ timestamp, error: errorMessage, context });
    console.error('Error logged:', errorMessage, context);
}

// Save user data to MongoDB
async function saveUser(user) {
    if (!db) {
        console.error('Database not connected. Cannot save user.');
        return;
    }
    const usersCollection = db.collection('users');
    await usersCollection.updateOne({ id: user.id }, { $set: user }, { upsert: true });
}

// Load all users from MongoDB
async function loadUsers() {
    if (!db) {
        console.error('Database not connected. Cannot load users.');
        return [];
    }
    const usersCollection = db.collection('users');
    return await usersCollection.find({}).toArray();
}

// Save video data to MongoDB
async function saveVideo(video) {
    if (!db) {
        console.error('Database not connected. Cannot save video.');
        return;
    }
    const videosCollection = db.collection('videos');
    await videosCollection.insertOne(video);
}

// Load all videos from MongoDB
async function loadVideos() {
    if (!db) {
        console.error('Database not connected. Cannot load videos.');
        return [];
    }
    const videosCollection = db.collection('videos');
    return await videosCollection.find({}).toArray();
}

// Save user ID to MongoDB
async function saveUserId(userId) {
    if (!db) {
        console.error('Database not connected. Cannot save user ID.');
        return;
    }
    const usersIdCollection = db.collection('usersId');
    await usersIdCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

// Load all user IDs from MongoDB
async function loadUserIds() {
    if (!db) {
        console.error('Database not connected. Cannot load user IDs.');
        return [];
    }
    const usersIdCollection = db.collection('usersId');
    return await usersIdCollection.find({}).toArray();
}

// Save QR code image to MongoDB
async function saveQRCode(filePath, fileName) {
    if (!db) {
        console.error('Database not connected. Cannot save QR code.');
        return;
    }
    const qrCodesCollection = db.collection('qr_codes');
    const fileData = fs.readFileSync(filePath);
    const base64Data = fileData.toString('base64');

    await qrCodesCollection.insertOne({
        fileName: fileName,
        data: base64Data,
        timestamp: new Date().toISOString(),
    });
    console.log('QR code saved successfully:', fileName);
}

// Load QR code image from MongoDB
async function loadQRCode(fileName) {
    if (!db) {
        console.error('Database not connected. Cannot load QR code.');
        return null;
    }
    const qrCodesCollection = db.collection('qr_codes');
    const qrCode = await qrCodesCollection.findOne({ fileName: fileName });
    return qrCode ? qrCode.data : null;
}

// Load admin IDs from .env
const admins = process.env.ADMIN_IDS.split(',').map(Number);

const BOT_TOKEN = process.env.BOT_TOKEN; // Load bot token from .env
const CHANNEL_USERNAME = '@clipscloud'; // Replace with your channel username
const ADMIN_GROUP_ID = -1002446731306; // Load admin channel ID from .env

const bot = new Telegraf(BOT_TOKEN);

// Check if user is in the channel
async function checkUserInChannel(userId) {
    try {
        const member = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
        return member.status !== 'left';
    } catch (err) {
        logError(err); // Log the error
        return false;
    }
}

// Welcome message with buttons
function sendWelcomeMessage(ctx) {
    ctx.reply(
        'Welcome to the bot! Please join our channel to continue.',
        Markup.inlineKeyboard([
            [Markup.button.url('Join Channel', `https://t.me/${CHANNEL_USERNAME.slice(1)}`)],
            [Markup.button.callback('I Have Joined', 'check_join')],
        ])
    );
}

// Handle /start command
bot.command('start', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process /start command.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ id: userId });

        if (!user) {
            // Initialize user with default values
            const newUser = {
                id: userId,
                username: ctx.from.username || '',
                name: ctx.from.first_name || '',
                joined: false,
                premium: false,
                videoCount: 0,
                lastVideoDate: null,
                videoIndex: 0,
                welcomed: false,
            };
            await usersCollection.insertOne(newUser);

            // Save user ID to usersId collection
            await saveUserId(userId);
        }

        sendWelcomeMessage(ctx);
    } catch (err) {
        console.error('Error in /start command:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Handle "I Have Joined" button
bot.action('check_join', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process check_join action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;
        const isMember = await checkUserInChannel(userId);

        if (isMember) {
            const usersCollection = db.collection('users');
            let user = await usersCollection.findOne({ id: userId });

            // If the user doesn't exist, initialize them with default values
            if (!user) {
                user = {
                    id: userId,
                    username: ctx.from.username || '',
                    name: ctx.from.first_name || '',
                    joined: false,
                    premium: false,
                    videoCount: 0,
                    lastVideoDate: null,
                    videoIndex: 0,
                    welcomed: false,
                };
                await usersCollection.insertOne(user);
            }

            user.joined = true;
            await saveUser(user);

            ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Remove buttons
            ctx.reply('Welcome! You can now use the bot.');

            if (!user.welcomed) {
                const welcomeMessage = await ctx.reply('This is your first time using the bot. Enjoy!');
                user.welcomed = true;
                await saveUser(user);

                // Delete welcome message after 30 seconds
                setTimeout(() => ctx.deleteMessage(welcomeMessage.message_id), 30000);
            }

            ctx.reply(
                'Click below to get videos:',
                Markup.inlineKeyboard([[Markup.button.callback('Get Videos', 'get_videos')]])
            );
        } else {
            ctx.answerCbQuery('You have not joined the channel yet. Please join and try again.');
        }
    } catch (err) {
        console.error('Error in check_join action:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Handle "Get Videos" button
bot.action('get_videos', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process get_videos action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;
        const usersCollection = db.collection('users');
        let user = await usersCollection.findOne({ id: userId });

        if (!user) {
            ctx.reply('User not found. Please use /start to initialize your account.');
            return;
        }

        // Initialize videoCount and videoIndex if not set
        if (user.videoCount === null || user.videoCount === undefined) {
            user.videoCount = 0;
        }
        if (user.videoIndex === null || user.videoIndex === undefined) {
            user.videoIndex = 0;
        }

        const today = new Date().toDateString();
        if (user.lastVideoDate !== today) {
            user.lastVideoDate = today;
            user.videoCount = 0;
            user.videoIndex = 0; // Reset video index for the day
        }

        if (user.videoCount >= 20 && !user.premium) {
            ctx.reply(
                'You have reached your daily limit. Purchase premium to continue.',
                Markup.inlineKeyboard([[Markup.button.callback('Purchase Premium', 'purchase_premium')]])
            );
            return;
        }

        const videos = await loadVideos();
        if (videos.length === 0) {
            ctx.reply('No videos available.');
            return;
        }

        const remainingVideos = videos.length - user.videoIndex;
        const videosToSendCount = Math.min(5, remainingVideos);

        if (videosToSendCount <= 0) {
            ctx.reply('No more videos available.');
            return;
        }

        const videosToSend = videos.slice(user.videoIndex, user.videoIndex + videosToSendCount);
        for (const video of videosToSend) {
            try {
                // Attempt to send the video
                await ctx.replyWithVideo(video.fileId);
            } catch (err) {
                if (err.response && err.response.error_code === 403) {
                    console.log(`User ${ctx.from.id} has blocked the bot. Skipping video.`);
                } else {
                    console.error('Error sending video:', err);
                    logError(err, ctx); // Log the error

                    // Notify the user about the invalid video
                    await ctx.reply('Sorry, this video is unavailable. Skipping to the next one.');

                    // Optionally, remove the invalid video from the database
                    const videosCollection = db.collection('videos');
                    await videosCollection.deleteOne({ fileId: video.fileId });
                }
            }
        }

        user.videoIndex += videosToSendCount;
        user.videoCount += videosToSendCount;
        await saveUser(user);

        if (user.videoIndex < videos.length) {
            ctx.reply(
                'Click below to get more videos:',
                Markup.inlineKeyboard([[Markup.button.callback('Get Videos', 'get_videos')]])
            );
        } else {
            ctx.reply('You have reached the end of the video list.');
        }
    } catch (err) {
        console.error('Error fetching videos:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred while fetching videos.');
    }
});

// Handle "Purchase Premium" button
bot.action('purchase_premium', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process purchase_premium action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;

        console.log(`[INFO] User ${userId} clicked "Purchase Premium"`);

        // Load the latest QR code from MongoDB
        const qrCodeData = await loadQRCode('qr_code.jpg');
        if (!qrCodeData) {
            ctx.reply('QR code not found. Please contact the admin.');
            return;
        }

        // Send the QR code image
        await ctx.replyWithPhoto({ source: Buffer.from(qrCodeData, 'base64') }, {
            caption: 'Please send the payment proof after completing the payment.',
        });

        const paymentProofHandler = async (ctx) => {
            try {
                if (ctx.from.id === userId && ctx.message.photo) {
                    const proof = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                    console.log('[INFO] Payment proof file ID:', proof);

                    const user = ctx.from;
                    const adminMessage = `💳 *Payment Proof Received*\n👤 *Name:* ${user.first_name}\n🆔 *User ID:* ${user.id}\n👥 *Username:* @${user.username || 'N/A'}\n🔗 [Open Profile](https://t.me/${user.username || user.id})`;

                    await bot.telegram.sendPhoto(ADMIN_GROUP_ID, proof, {
                        caption: adminMessage,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: 'Verify', callback_data: `verify_${userId}` }]],
                        },
                    });

                    console.log('[SUCCESS] Payment proof sent to admin group');
                    await ctx.reply('Payment proof received. Admins will verify it shortly.');

                    bot.off('message', paymentProofHandler); // Use bot.off instead of ctx.telegram.off
                }
            } catch (err) {
                logError(err); // Log the error
            }
        };

        bot.on('message', paymentProofHandler);

        setTimeout(() => {
            console.log('[INFO] Payment proof listener timed out');
            bot.off('message', paymentProofHandler); // Use bot.off instead of ctx.telegram.off
            ctx.reply('Payment proof submission timed out. Please try again if needed.');
        }, 300000); // 5 minutes timeout
    } catch (err) {
        logError(err); // Log the error
        ctx.reply('An error occurred while processing your request. Please report at @awt_bots_chats');
    }
});

// Handle "Verify" button in admin group
bot.action(/verify_(\d+)/, async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process verify action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = parseInt(ctx.match[1], 10);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ id: userId });

        if (user) {
            user.premium = true;
            await saveUser(user);

            await ctx.reply('Payment verified. User is now premium.');
            await bot.telegram.sendMessage(userId, 'Thank you for purchasing premium!');
        } else {
            await ctx.reply('User not found in the database.');
        }
    } catch (err) {
        console.error('Error in verify action:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Admin commands
bot.command('admin', (ctx) => {
    const userId = ctx.from.id;
    if (!admins.includes(userId)) {
        ctx.reply('You are not an admin.');
        return;
    }

    ctx.reply(
        'Admin Panel',
        Markup.inlineKeyboard([
            [Markup.button.callback('Total Users', 'total_users')],
            [Markup.button.callback('Total Videos', 'total_videos')],
            [Markup.button.callback('Broadcast', 'broadcast')],
            [Markup.button.callback('Data', 'data')],
            [Markup.button.callback('Premium Users', 'premium_users')],
            [Markup.button.callback('Upload QR Code', 'upload_qr_code')], // New button for uploading QR code
        ])
    );
});

// Handle admin buttons
bot.action('total_users', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process total_users action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const usersCollection = db.collection('users');
        const totalUsers = await usersCollection.countDocuments();
        ctx.reply(`Total Users: ${totalUsers}`);
    } catch (err) {
        console.error('Error fetching total users:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action('total_videos', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process total_videos action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const videosCollection = db.collection('videos');
        const totalVideos = await videosCollection.countDocuments();
        ctx.reply(`Total Videos: ${totalVideos}`);
    } catch (err) {
        console.error('Error fetching total videos:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.action('premium_users', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process premium_users action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const usersCollection = db.collection('users');
        const premiumUsers = await usersCollection.countDocuments({ premium: true });
        ctx.reply(`Premium Users: ${premiumUsers}`);
    } catch (err) {
        console.error('Error fetching premium users:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Handle "Upload QR Code" button
bot.action('upload_qr_code', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process upload_qr_code action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;

        if (!admins.includes(userId)) {
            ctx.reply('You are not authorized to upload QR codes.');
            return;
        }

        ctx.reply('Please send the QR code image.');

        const qrCodeHandler = async (ctx) => {
            try {
                if (ctx.from.id === userId && ctx.message.photo) {
                    const photo = ctx.message.photo[ctx.message.photo.length - 1];
                    const fileId = photo.file_id;
                    const filePath = path.join(__dirname, 'qr_code.jpg');

                    // Download the photo using axios
                    const fileLink = await bot.telegram.getFileLink(fileId);
                    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
                    const buffer = Buffer.from(response.data);

                    // Save the file locally
                    fs.writeFileSync(filePath, buffer);

                    // Save the QR code to MongoDB
                    await saveQRCode(filePath, 'qr_code.jpg');

                    ctx.reply('QR code uploaded successfully!');
                    bot.off('message', qrCodeHandler); // Use bot.off instead of ctx.telegram.off
                }
            } catch (err) {
                logError(err); // Log the error
                ctx.reply('An error occurred while uploading the QR code.');
            }
        };

        bot.on('message', qrCodeHandler);

        setTimeout(() => {
            console.log('[INFO] QR code upload listener timed out');
            bot.off('message', qrCodeHandler); // Use bot.off instead of ctx.telegram.off
            ctx.reply('QR code upload timed out. Please try again if needed.');
        }, 300000); // 5 minutes timeout
    } catch (err) {
        console.error('Error in upload_qr_code action:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

// Broadcast function
// Broadcast function
bot.action('broadcast', (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process broadcast action.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        ctx.reply('Send the message, video, or photo you want to broadcast.');
        bot.on('message', async (msg) => {
            if (admins.includes(msg.from.id)) {
                const usersCollection = db.collection('users');
                const users = await usersCollection.find({}).toArray();
                let successCount = 0;
                let failCount = 0;

                for (const user of users) {
                    try {
                        if (msg.photo) {
                            await bot.telegram.sendPhoto(user.id, msg.photo[0].file_id, { caption: msg.caption });
                        } else if (msg.video) {
                            await bot.telegram.sendVideo(user.id, msg.video.file_id, { caption: msg.caption });
                        } else {
                            await bot.telegram.sendMessage(user.id, msg.text);
                        }
                        successCount++;
                    } catch (err) {
                        if (err.response && err.response.error_code === 403) {
                            console.log(`User ${user.id} has blocked the bot. Skipping message.`);
                        } else {
                            console.error('Error sending message to user:', err);
                            logError(err); // Log other errors
                        }
                        failCount++;
                    }
                }

                ctx.reply(`Broadcast completed. Success: ${successCount}, Failed: ${failCount}`);
            }
        });
    } catch (err) {
        console.error('Error in broadcast action:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred. Please try again later.');
    }
});

bot.on('video', async (ctx) => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot process video upload.');
            return ctx.reply('Database connection error. Please try again later.');
        }

        const userId = ctx.from.id;

        // Check if the user is an admin
        if (!admins.includes(userId)) {
            ctx.reply('You are not authorized to upload videos.');
            return;
        }

        // Get the video file ID and other details
        const videoFileId = ctx.message.video.file_id;
        const uploaderId = ctx.from.id;
        const timestamp = new Date().toISOString();

        // Validate the file_id by attempting to send the video
        try {
            await ctx.replyWithVideo(videoFileId);
        } catch (err) {
            console.error('Invalid file_id:', err);
            await ctx.reply('The video file is invalid. Please upload a valid video.');
            return;
        }

        // Save the video details to the videos collection
        const videosCollection = db.collection('videos');
        await videosCollection.insertOne({
            fileId: videoFileId,
            uploaderId: uploaderId,
            timestamp: timestamp,
        });

        ctx.reply('Video uploaded successfully!');
    } catch (err) {
        console.error('Error in video upload:', err);
        logError(err, ctx); // Log the error with context
        ctx.reply('An error occurred while uploading the video.');
    }
});

// Send data to admin channel every 60 minutes
cron.schedule('*/60 * * * *', async () => {
    try {
        if (!db) {
            console.error('Database not connected. Cannot send data to admin channel.');
            return;
        }

        const usersCount = await db.collection('users').countDocuments();
        const videosCount = await db.collection('videos').countDocuments();
        const usersIdCount = await db.collection('usersId').countDocuments();

        await bot.telegram.sendMessage(ADMIN_GROUP_ID, `Total Users: ${usersCount}\nTotal Videos: ${videosCount}\nTotal User IDs: ${usersIdCount}`);
    } catch (err) {
        console.error('Error in cron job:', err);
        logError(err); // Log the error
    }
});

// Start the bot after connecting to MongoDB
async function startBot() {
    try {
        await connectToMongoDB(); // Wait for MongoDB connection
        bot.launch();
        console.log('Bot is running...');
    } catch (err) {
        console.error('Failed to start the bot:', err);
    }
}

// Start the bot
startBot();

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('Shutting down gracefully...');
    bot.stop('SIGINT');
    process.exit();
});

process.once('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    bot.stop('SIGTERM');
    process.exit();
});
