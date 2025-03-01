const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = '@ClipsCloud';
const CHANNEL_LINK = 'https://t.me/ClipsCloud';
const ADMIN_IDS = [process.env.ADMIN_ID, process.env.ADMIN_ID_2, process.env.ADMIN_ID_3,process.env.ADMIN_ID_4];
const USERS_FILE = 'users.json';
const VIDEOS_FILE = 'videos.json';
const GROUP_ID = '-4602723399';
const QR_CODE_IMAGE = 'qr_code_50.jpg';
//const PAYMENT_CHANNEL = '@whiteshadowmallu';
const DAILY_VIDEO_LIMIT = 50;

let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        const fileContent = fs.readFileSync(USERS_FILE, 'utf8');
        users = fileContent ? JSON.parse(fileContent) : {};
    } catch (error) {
        console.error('Failed to parse users.json:', error.message);
        users = {};
    }
}

let videos = fs.existsSync(VIDEOS_FILE) ? JSON.parse(fs.readFileSync(VIDEOS_FILE)) : [];

const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const saveVideos = () => fs.writeFileSync(VIDEOS_FILE, JSON.stringify(videos, null, 2));

const checkMembership = async (userId) => {
    try {
        const chatMember = await bot.telegram.getChatMember(CHANNEL_ID, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error('Error checking membership:', error.message);
        return false;
    }
};

const requireMembership = (handler) => async (ctx) => {
    const userId = ctx.from.id;
    if (await checkMembership(userId)) {
        return handler(ctx);
    } else {
        await ctx.reply('🚨 You need to join our Telegram channel to use this bot:',
            Markup.inlineKeyboard([
                [Markup.button.url('🔗 Join Channel', CHANNEL_LINK)],
                [Markup.button.callback('✅ I Have Joined', 'check_membership')]
            ])
        );
    }
};

// Function to delete a message after 5 minute
const deleteAfterDelay = async (chatId, messageId, delay = 300000) => {
    setTimeout(async () => {
        try {
            await bot.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
            console.error(`Failed to delete message ${messageId}:`, error.message);
        }
    }, delay);
};

bot.start(requireMembership(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    if (!users[userId]) {
        users[userId] = { id: userId, name: userName, videosSentToday: 0, receivedVideos: [], isPremium: false };
        saveUsers();
        await ctx.telegram.sendMessage(GROUP_ID, `New user started the bot: ${userName} (ID: ${userId})`);
        await ctx.telegram.sendDocument(GROUP_ID, { source: USERS_FILE });
    }

    const reply = await ctx.reply('🎉 Welcome! Click below to get videos:',
        Markup.inlineKeyboard([[Markup.button.callback('📽 Get Videos', 'get_videos')]])
    );

    // Delete the welcome message after 5 minute
    deleteAfterDelay(ctx.chat.id, reply.message_id);
}));

bot.action('check_membership', async (ctx) => {
    const userId = ctx.from.id;

    if (await checkMembership(userId)) {
        const reply = await ctx.reply('✅ Thank you for joining! You can now use the bot by sending /start');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    } else {
        const reply = await ctx.reply('❌ It seems you haven’t joined yet. Please join the channel and try again.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    }
});

bot.action('get_videos', async (ctx) => {
    const userId = ctx.from.id;
    if (!users[userId]) {
        users[userId] = { id: userId, name: ctx.from.username || ctx.from.first_name, videosSentToday: 0, receivedVideos: [], isPremium: false };
        saveUsers();
    }
    const user = users[userId];

    if (user.videosSentToday >= DAILY_VIDEO_LIMIT && !user.isPremium) {
        const reply = await ctx.reply('❌ You’ve reached your daily limit of 50 videos. Need more? Subscribe below:',
            Markup.inlineKeyboard([
                [Markup.button.callback('💳 Subscribe for More', 'subscribe')]
            ])
        );
        deleteAfterDelay(ctx.chat.id, reply.message_id);
        return;
    }

    const availableVideos = videos.filter(v => !user.receivedVideos.includes(v));
    const newVideos = availableVideos.slice(0, 10);

    if (newVideos.length === 0) {
        const reply = await ctx.reply('No new videos available.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
        return;
    }

    for (const video of newVideos) {
        try {
            const msg = await ctx.telegram.sendVideo(userId, video);
            deleteAfterDelay(userId, msg.message_id); // Delete video after 5 minute
        } catch (error) {
            console.error(`Failed to send video to user ${userId}:`, error.message);
        }
    }

    user.videosSentToday += newVideos.length;
    user.receivedVideos.push(...newVideos);
    saveUsers();

    const reply = await ctx.reply('These videos will be deleted in 5 minute. so please save or forward to saved',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Get More', 'get_videos')]])
    );
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('subscribe', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    users[userId].waitingForPaymentProof = true;
    saveUsers();

    const reply = await ctx.replyWithPhoto({ source: QR_CODE_IMAGE }, { caption: '💳 Scan this QR code to make a payment of 50rs. After payment, send your proof of payment here.' });
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;
    const user = users[userId];

    if (user && user.waitingForPaymentProof) {
        const photo = ctx.message.photo[0].file_id;

        // Send payment proof to admin group with a "Verify Payment" button
        const adminMessage = await ctx.telegram.sendPhoto(
            GROUP_ID,
            photo,
            {
                caption: `Payment proof from user: ${userName} (ID: ${userId})`,
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Verify Payment', `verify_payment:${userId}`)]
                ]).reply_markup
            }
        );

        const userReply = await ctx.reply('✅ Your payment proof has been sent for verification. Please wait for confirmation.');
        deleteAfterDelay(ctx.chat.id, userReply.message_id); // Delete user confirmation message after 1 minute
        deleteAfterDelay(GROUP_ID, adminMessage.message_id); // Delete admin message after 1 minute

        user.waitingForPaymentProof = false;
        saveUsers();
    }
});

// Handle admin verification
bot.action(/verify_payment:(\d+)/, async (ctx) => {
    const userId = ctx.match[1];
    const user = users[userId];

    if (user) {
        user.isPremium = true; // Remove daily limit
        saveUsers();

        const adminReply = await ctx.telegram.sendMessage(GROUP_ID, `✅ Payment verified for user: ${user.name} (ID: ${userId}). Daily limit removed.`);
        const userReply = await ctx.telegram.sendMessage(userId, '🎉 Your payment has been verified! You now have unlimited access to videos.');

        deleteAfterDelay(GROUP_ID, adminReply.message_id); // Delete admin verification message after 5 minute
        deleteAfterDelay(userId, userReply.message_id); // Delete user verification message after 5 minute
    } else {
        const reply = await ctx.reply('❌ User not found.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    }
});

bot.on('video', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const fileId = ctx.message.video.file_id;
    if (!videos.includes(fileId)) {
        videos.push(fileId);
        saveVideos();

        const reply = await ctx.reply('🎉 Video added to the database!');
        const videoMessage = await ctx.telegram.sendVideo(GROUP_ID, fileId);

        deleteAfterDelay(ctx.chat.id, reply.message_id); // Delete confirmation message after 5 minute
        deleteAfterDelay(GROUP_ID, videoMessage.message_id); // Delete video message after 5 minute
    } else {
        const reply = await ctx.reply('⚠️ This video is already in the database.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    }
});

bot.command('data', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    try {
        const usersFile = await ctx.telegram.sendDocument(ctx.chat.id, { source: USERS_FILE });
        const videosFile = await ctx.telegram.sendDocument(ctx.chat.id, { source: VIDEOS_FILE });

        deleteAfterDelay(ctx.chat.id, usersFile.message_id); // Delete users file message after 5 minute
        deleteAfterDelay(ctx.chat.id, videosFile.message_id); // Delete videos file message after 5 minute
    } catch (error) {
        console.error('Error sending data:', error);
        const reply = await ctx.reply('❌ Failed to send data files.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    }
});

bot.command('broadcast', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const text = ctx.message.text.split(' ').slice(1).join(' ');

    if (!text && !ctx.message.video) {
        const reply = await ctx.reply('⚠️ Please provide a message or video to broadcast.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
        return;
    }

    const userIds = Object.keys(users);

    for (const userId of userIds) {
        try {
            if (text) {
                const msg = await bot.telegram.sendMessage(userId, text);
                deleteAfterDelay(userId, msg.message_id); // Delete broadcast message after 5 minute
            } else if (ctx.message.video) {
                const msg = await bot.telegram.sendVideo(userId, ctx.message.video.file_id);
                deleteAfterDelay(userId, msg.message_id); // Delete broadcast video after 5 minute
            }
        } catch (error) {
            console.error(`Failed to send to ${userId}:`, error);
        }
    }

    const reply = await ctx.reply('📢 Broadcast sent successfully!');
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.launch();
