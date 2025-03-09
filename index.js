require('dotenv').config(); // Load environment variables from .env
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');

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
async function logError(error) {
    const errorsCollection = db.collection('errors');
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error.stack || error}`;

    await errorsCollection.insertOne({ timestamp, error: errorMessage });
    console.error('Error logged:', errorMessage);
}

// Save user data to MongoDB
async function saveUser(user) {
    const usersCollection = db.collection('users');
    await usersCollection.updateOne({ id: user.id }, { $set: user }, { upsert: true });
}

// Load all users from MongoDB
async function loadUsers() {
    const usersCollection = db.collection('users');
    return await usersCollection.find({}).toArray();
}

// Save video data to MongoDB
async function saveVideo(video) {
    const videosCollection = db.collection('videos');
    await videosCollection.insertOne(video);
}

// Load all videos from MongoDB
async function loadVideos() {
    const videosCollection = db.collection('videos');
    return await videosCollection.find({}).toArray();
}

// Save user ID to MongoDB
async function saveUserId(userId) {
    const usersIdCollection = db.collection('usersId');
    await usersIdCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

// Load all user IDs from MongoDB
async function loadUserIds() {
    const usersIdCollection = db.collection('usersId');
    return await usersIdCollection.find({}).toArray();
}

// Call the connection function
connectToMongoDB();

// Load admin IDs from .env
const admins = process.env.ADMIN_ID.split(',').map(Number);

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

bot.command('start', async (ctx) => {
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
});

// Handle "I Have Joined" button
bot.action('check_join', async (ctx) => {
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
});

// Handle "Get Videos" button
bot.action('get_videos', async (ctx) => {
    const userId = ctx.from.id;
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ id: userId });

    try {
        console.log('Fetching videos for user:', userId);

        // Ensure videoCount and videoIndex are initialized
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
        console.log('Total videos fetched:', videos.length);

        if (videos.length === 0) {
            ctx.reply('No videos available.');
            return;
        }

        // Calculate the number of videos to send (maximum 5)
        const remainingVideos = videos.length - user.videoIndex;
        const videosToSendCount = Math.min(5, remainingVideos); // Send up to 5 videos

        if (videosToSendCount <= 0) {
            ctx.reply('No more videos available.');
            return;
        }

        // Send the videos
        const videosToSend = videos.slice(user.videoIndex, user.videoIndex + videosToSendCount);
        for (const video of videosToSend) {
            console.log('Sending video:', video.fileId);
            await ctx.replyWithVideo(video.fileId);
        }

        // Update user's video index and count
        user.videoIndex += videosToSendCount;
        user.videoCount += videosToSendCount;
        await saveUser(user);

        // Show "Get Videos" button again if there are more videos
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
        logError(err); // Log the error
        ctx.reply('An error occurred while fetching videos.');
    }
});

// Handle "Purchase Premium" button
bot.action('purchase_premium', async (ctx) => {
    const userId = ctx.from.id;

    console.log(`[INFO] User ${userId} clicked "Purchase Premium"`);

    try {
        // Send QR code image from server
        await ctx.replyWithPhoto({ source: './qr_code.jpg' }, {
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

                    ctx.telegram.off('message', paymentProofHandler); // Fix: Use ctx.telegram.off
                }
            } catch (err) {
                logError(err); // Log the error
            }
        };

        bot.on('message', paymentProofHandler);

        setTimeout(() => {
            console.log('[INFO] Payment proof listener timed out');
            ctx.telegram.off('message', paymentProofHandler); // Fix: Use ctx.telegram.off
            ctx.reply('Payment proof submission timed out. Please try again if needed.');
        }, 300000); // 5 minutes timeout
    } catch (err) {
        logError(err); // Log the error
        ctx.reply('An error occurred while processing your request.');
    }
});

// Handle "Verify" button in admin group
bot.action(/verify_(\d+)/, async (ctx) => {
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
        ])
    );
});

// Handle admin buttons
bot.action('total_users', async (ctx) => {
    const usersCollection = db.collection('users');
    const totalUsers = await usersCollection.countDocuments();
    ctx.reply(`Total Users: ${totalUsers}`);
});

bot.action('total_videos', async (ctx) => {
    const videosCollection = db.collection('videos');
    const totalVideos = await videosCollection.countDocuments();
    ctx.reply(`Total Videos: ${totalVideos}`);
});

bot.action('premium_users', async (ctx) => {
    const usersCollection = db.collection('users');
    const premiumUsers = await usersCollection.countDocuments({ premium: true });
    ctx.reply(`Premium Users: ${premiumUsers}`);
});

// Broadcast function
bot.action('broadcast', (ctx) => {
    ctx.reply('Send the message, video, or photo you want to broadcast.');
    bot.on('message', async (msg) => {
        if (admins.includes(msg.from.id)) {
            const usersCollection = db.collection('users');
            const users = await usersCollection.find({}).toArray();
            for (const user of users) {
                try {
                    if (msg.photo) {
                        await bot.telegram.sendPhoto(user.id, msg.photo[0].file_id, { caption: msg.caption });
                    } else if (msg.video) {
                        await bot.telegram.sendVideo(user.id, msg.video.file_id, { caption: msg.caption });
                    } else {
                        await bot.telegram.sendMessage(user.id, msg.text);
                    }
                } catch (err) {
                    logError(err); // Log the error
                }
            }
            ctx.reply('Broadcast completed.');
        }
    });
});

// Handle video uploads from admins
bot.on('video', async (ctx) => {
    const userId = ctx.from.id;

    // Check if the user is an admin
    if (!admins.includes(userId)) {
        ctx.reply('You are not authorized to upload videos.');
        return;
    }

    try {
        // Get the video file ID and other details
        const videoFileId = ctx.message.video.file_id;
        const uploaderId = ctx.from.id;
        const timestamp = new Date().toISOString();

        // Save the video details to the videos collection
        const videosCollection = db.collection('videos');
        await videosCollection.insertOne({
            fileId: videoFileId,
            uploaderId: uploaderId,
            timestamp: timestamp,
        });

        ctx.reply('Video uploaded successfully!');
    } catch (err) {
        logError(err); // Log the error
        ctx.reply('An error occurred while uploading the video.');
    }
});

// Send data to admin channel every 60 minutes
cron.schedule('*/60 * * * *', async () => {
    try {
        const usersCount = await db.collection('users').countDocuments();
        const videosCount = await db.collection('videos').countDocuments();
        const usersIdCount = await db.collection('usersId').countDocuments();

        await bot.telegram.sendMessage(ADMIN_GROUP_ID, `Total Users: ${usersCount}\nTotal Videos: ${videosCount}\nTotal User IDs: ${usersIdCount}`);
    } catch (err) {
        logError(err);
    }
});

// Start the bot
try {
    bot.launch();
    console.log('Bot is running...');
} catch (err) {
    console.error('Failed to start the bot:', err);
}
