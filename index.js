require('dotenv').config(); // Load environment variables from .env
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Function to log errors to a file
function logError(error) {
    const errorLogPath = path.join(__dirname, 'error.log');
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error.stack || error}\n`;

    // Append the error to the error log file
    fs.appendFileSync(errorLogPath, errorMessage);
    console.error('Error logged:', errorMessage);
}

// Function to load or create JSON files
function loadOrCreateJSON(filePath, defaultValue = []) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        console.log(`Created ${filePath} with default value:`, defaultValue);
    }
    return JSON.parse(fs.readFileSync(filePath));
}

// Define paths for JSON files
const usersFilePath = path.join(__dirname, 'users.json');
const videosFilePath = path.join(__dirname, 'videos.json');
const adminsFilePath = path.join(__dirname, 'admins.json');
const usersIdFilePath = path.join(__dirname, 'usersid.json'); // New file for user IDs

// Load or create JSON files
let users = loadOrCreateJSON(usersFilePath);
let videos = loadOrCreateJSON(videosFilePath);
let usersId = loadOrCreateJSON(usersIdFilePath, []); // Load or create usersid.json
const admins = process.env.ADMIN_IDS.split(',').map(Number); // Load admin IDs from .env

const BOT_TOKEN = process.env.BOT_TOKEN; // Load bot token from .env
const CHANNEL_USERNAME = '@clipscloud'; // Replace with your channel username
const ADMIN_GROUP_ID = -1002446731306; // Load admin channel ID from .env

const bot = new Telegraf(BOT_TOKEN);

// Save JSON files
function saveUsers() {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
}

function saveVideos() {
    fs.writeFileSync(videosFilePath, JSON.stringify(videos, null, 2));
}

// Function to update usersid.json and send it to the admin channel
function updateUsersIdAndSendToAdmin(userId) {
    // Add the new user ID if it doesn't already exist
    if (!usersId.includes(userId)) {
        usersId.push(userId);
        fs.writeFileSync(usersIdFilePath, JSON.stringify(usersId, null, 2));
        console.log(`Updated usersid.json with new user ID: ${userId}`);

        // Send the updated usersid.json to the admin channel
        bot.telegram.sendDocument(ADMIN_GROUP_ID, { source: usersIdFilePath })
            .then(() => console.log('Sent usersid.json to admin channel'))
            .catch((err) => logError(err)); // Log the error
    }
}

// Handle video uploads from admins
bot.on('video', async (ctx) => {
    const userId = ctx.from.id;

    // Check if the user is an admin
    if (!admins.includes(userId)) {
        ctx.reply('You are not authorized to upload videos.');
        return;
    }

    try {
        // Get the video file ID
        const videoFileId = ctx.message.video.file_id;

        // Save the video file ID to videos.json
        videos.push({ fileId: videoFileId });
        saveVideos();

        ctx.reply('Video uploaded successfully!');
    } catch (err) {
        logError(err); // Log the error
        ctx.reply('An error occurred while uploading the video.');
    }
});

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
    const userId = ctx.from.id;
    const user = users.find((u) => u.id === userId);

    if (!user) {
        // Initialize user with default values
        users.push({
            id: userId,
            username: ctx.from.username || '',
            name: ctx.from.first_name || '',
            joined: false,
            premium: false,
            videoCount: 0, // Initialize videoCount
            lastVideoDate: null,
            videoIndex: 0, // Initialize videoIndex
            welcomed: false // Initialize welcomed
        });
        saveUsers();

        // Update usersid.json and send it to the admin channel
        updateUsersIdAndSendToAdmin(userId);
    }

    sendWelcomeMessage(ctx);
});

// Handle "I Have Joined" button
bot.action('check_join', async (ctx) => {
    const userId = ctx.from.id;
    const isMember = await checkUserInChannel(userId);

    if (isMember) {
        let user = users.find((u) => u.id === userId);

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
                welcomed: false
            };
            users.push(user);
            saveUsers();
        }

        user.joined = true;
        saveUsers();

        ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Remove buttons
        ctx.reply('Welcome! You can now use the bot.');

        if (!user.welcomed) {
            const welcomeMessage = await ctx.reply('This is your first time using the bot. Enjoy!');
            user.welcomed = true;
            saveUsers();

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
    const user = users.find((u) => u.id === userId);

    try {
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
            await ctx.replyWithVideo(video.fileId);
        }

        // Update user's video index and count
        user.videoIndex += videosToSendCount;
        user.videoCount += videosToSendCount;
        saveUsers();

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
               // await ctx.reply('An error occurred while processing the payment proof.');
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
    const userId = parseInt(ctx.match[1], 20);
    const user = users.find((u) => u.id === userId);

    if (user) {
        user.premium = true;
        saveUsers();

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
bot.action('total_users', (ctx) => ctx.reply(`Total Users: ${users.length}`));
bot.action('total_videos', (ctx) => ctx.reply(`Total Videos: ${videos.length}`));
bot.action('premium_users', (ctx) => {
    const premiumUsers = users.filter((u) => u.premium);
    ctx.reply(`Premium Users: ${premiumUsers.length}`);
});

// Broadcast function
bot.action('broadcast', (ctx) => {
    ctx.reply('Send the message, video, or photo you want to broadcast.');
    bot.on('message', async (msg) => {
        if (admins.includes(msg.from.id)) {
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

// Send JSON files to admin channel every 15 minutes
cron.schedule('*/15 * * * *', () => {
    try {
        bot.telegram.sendDocument(ADMIN_GROUP_ID, { source: usersFilePath });
        bot.telegram.sendDocument(ADMIN_GROUP_ID, { source: videosFilePath });
        bot.telegram.sendDocument(ADMIN_GROUP_ID, { source: usersIdFilePath });
    } catch (err) {
        logError(err); // Log the error
    }
});

// Start the bot
bot.launch();
console.log('Bot is running...');
