const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = '@ClipsCloud';
const CHANNEL_LINK = 'https://t.me/ClipsCloud';
const ADMIN_IDS = [process.env.ADMIN_ID, process.env.ADMIN_ID_2, process.env.ADMIN_ID_3];
const USERS_FILE = 'users.json';
const VIDEOS_FILE = 'videos.json';
const PENDING_REQUESTS_FILE = 'pendingrqst.json';
const USER_IDS_FILE = 'userid.json';
const PREMIUM_USERS_FILE = 'premiumusers.json';
const GROUP_ID = '-1002446731306';
const QR_CODE_IMAGE = 'qr_code_5.jpg';
const DAILY_VIDEO_LIMIT = 25;

let users = {};
let videos = [];
let pendingRequests = [];
let userIds = [];
let premiumUsers = [];

// Load data from files
const loadData = () => {
    if (fs.existsSync(USERS_FILE)) {
        try {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } catch (error) {
            console.error('Failed to parse users.json:', error.message);
        }
    }
    if (fs.existsSync(VIDEOS_FILE)) {
        try {
            videos = JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf8'));
        } catch (error) {
            console.error('Failed to parse videos.json:', error.message);
        }
    }
    if (fs.existsSync(PENDING_REQUESTS_FILE)) {
        try {
            pendingRequests = JSON.parse(fs.readFileSync(PENDING_REQUESTS_FILE, 'utf8'));
        } catch (error) {
            console.error('Failed to parse pendingrqst.json:', error.message);
        }
    }
    if (fs.existsSync(USER_IDS_FILE)) {
        try {
            userIds = JSON.parse(fs.readFileSync(USER_IDS_FILE, 'utf8'));
        } catch (error) {
            console.error('Failed to parse userid.json:', error.message);
        }
    }
    if (fs.existsSync(PREMIUM_USERS_FILE)) {
        try {
            premiumUsers = JSON.parse(fs.readFileSync(PREMIUM_USERS_FILE, 'utf8'));
        } catch (error) {
            console.error('Failed to parse premiumusers.json:', error.message);
        }
    }
};

// Save data to files
const saveData = () => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    fs.writeFileSync(VIDEOS_FILE, JSON.stringify(videos, null, 2));
    fs.writeFileSync(PENDING_REQUESTS_FILE, JSON.stringify(pendingRequests, null, 2));
    fs.writeFileSync(USER_IDS_FILE, JSON.stringify(userIds, null, 2));
    fs.writeFileSync(PREMIUM_USERS_FILE, JSON.stringify(premiumUsers, null, 2));
};

// Initialize data
loadData();

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

const deleteAfterDelay = async (chatId, messageId, delay = 300000) => {
    setTimeout(async () => {
        try {
            await bot.telegram.deleteMessage(chatId, messageId);
        } catch (error) {
            console.error(`Failed to delete message ${messageId}:`, error.message);
        }
    }, delay);
};

// Ban a user
const banUser = (userId) => {
    if (users[userId]) {
        users[userId].banned = true;
        saveData();
    }
};

// Unban a user
const unbanUser = (userId) => {
    if (users[userId]) {
        users[userId].banned = false;
        saveData();
    }
};

// Remove premium status from a user
const removePremium = (userId) => {
    if (users[userId]) {
        users[userId].isPremium = false;
        premiumUsers = premiumUsers.filter(id => id !== userId);
        saveData();
    }
};

// Add premium status to a user
const addPremium = (userId) => {
    if (users[userId]) {
        users[userId].isPremium = true;
        if (!premiumUsers.includes(userId)) {
            premiumUsers.push(userId);
        }
        saveData();
    }
};

bot.start(requireMembership(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    if (!users[userId]) {
        users[userId] = { id: userId, name: userName, videosSentToday: 0, receivedVideos: [], isPremium: false, banned: false };
        if (!userIds.includes(userId)) {
            userIds.push(userId);
        }
        saveData();
        await ctx.telegram.sendMessage(GROUP_ID, `New user started the bot: ${userName} (ID: ${userId})`);
    }

    if (users[userId].banned) {
        await ctx.reply('🚫 You are banned from using this bot.');
        return;
    }

    const reply = await ctx.reply('🎉 Welcome! Click below to get videos:',
        Markup.inlineKeyboard([[Markup.button.callback('📽 Get Videos', 'get_videos')]])
    );

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
    let user = users[userId];

    // Initialize user if not present
    if (!user) {
        user = { id: userId, name: ctx.from.username || ctx.from.first_name, videosSentToday: 0, receivedVideos: [], isPremium: false, banned: false };
        users[userId] = user;
        userIds.push(userId);
        saveData();
    }

    if (user.banned) {
        await ctx.reply('🚫 You are banned from using this bot.');
        return;
    }

    if (user.videosSentToday >= DAILY_VIDEO_LIMIT && !user.isPremium) {
        const reply = await ctx.reply('❌ You’ve reached your daily limit of 25 videos. Need more? Subscribe below:',
            Markup.inlineKeyboard([[Markup.button.callback('💳 Subscribe for More', 'subscribe')]])
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
            console.log(`Sending video ID: ${video} to user ID: ${userId}`);
            const msg = await ctx.telegram.sendVideo(userId, video);
            console.log(`Successfully sent video ${video}`);
            deleteAfterDelay(userId, msg.message_id);
        } catch (error) {
            console.error(`Failed to send video ${video} to user ${userId}:`, error.message);
        }
    }

    user.videosSentToday += newVideos.length;
    user.receivedVideos.push(...newVideos);
    saveData();

    const reply = await ctx.reply('These videos will be deleted in 5 minutes. Please save or forward them to your saved messages.if you facing any issues contact @aadithcv',
        Markup.inlineKeyboard([[Markup.button.callback('🔄 Get More', 'get_videos')]])
    );
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('subscribe', async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name;

    users[userId].waitingForPaymentProof = true;
    saveData();

    const reply = await ctx.replyWithPhoto({ source: QR_CODE_IMAGE }, { caption: '💳 Scan this QR code to make a payment of 5rs. After payment, send your proof of payment here.' });
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];

    if (user && user.waitingForPaymentProof) {
        const photo = ctx.message.photo[0].file_id;

        // Save payment proof in pendingRequests
        pendingRequests.push({ userId, photo });
        saveData();

        const adminMessage = await ctx.telegram.sendPhoto(
            GROUP_ID,
            photo,
            {
                caption: `Payment proof from user: ${user.username || user.name} (ID: ${userId})`,
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback(`✅ Verify Payment`, `verify_payment:${userId}`)]
                ])
            }
        );

        const userReply = await ctx.reply('✅ Your payment proof has been sent for verification. Please wait for confirmation.');
        deleteAfterDelay(ctx.chat.id, userReply.message_id);
        deleteAfterDelay(GROUP_ID, adminMessage.message_id);

        user.waitingForPaymentProof = false;
        saveData();
    }
});

bot.action(/verify_payment:(\d+)/, async (ctx) => {
    const userId = ctx.match[1];
    const user = users[userId];

    if (user) {
        addPremium(userId);
        pendingRequests = pendingRequests.filter(request => request.userId !== userId);
        saveData();

        const adminReply = await ctx.telegram.sendMessage(GROUP_ID, `✅ Payment verified for user: ${user.name} (ID: ${userId}). Daily limit removed.`);
        const userReply = await ctx.telegram.sendMessage(userId, '🎉 Your payment has been verified! You now have unlimited access to videos.');

        deleteAfterDelay(GROUP_ID, adminReply.message_id);
        deleteAfterDelay(userId, userReply.message_id);
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
        saveData();

        console.log(`Added video to database: ${fileId}`); // Log added video
        await ctx.reply('🎉 Video added to the database!');
    } else {
        console.log(`Video already exists in the database: ${fileId}`);
        await ctx.reply('⚠️ This video is already in the database.');
    }
});

bot.command('data', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    try {
        await ctx.telegram.sendDocument(ctx.chat.id, { source: USERS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: VIDEOS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: PENDING_REQUESTS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: USER_IDS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: PREMIUM_USERS_FILE });
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

    for (const userId of userIds) {
        try {
            if (text) {
                const msg = await bot.telegram.sendMessage(userId, text);
                deleteAfterDelay(userId, msg.message_id);
            } else if (ctx.message.video) {
                const msg = await bot.telegram.sendVideo(userId, ctx.message.video.file_id);
                deleteAfterDelay(userId, msg.message_id);
            }
        } catch (error) {
            console.error(`Failed to send to ${userId}:`, error);
        }
    }

    const reply = await ctx.reply('📢 Broadcast sent successfully!');
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.command('admin', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const reply = await ctx.reply('Admin Commands:',
        Markup.inlineKeyboard([
            [Markup.button.callback('📢 Broadcast', 'admin_broadcast')],
            [Markup.button.callback('👥 Total Users', 'admin_total_users')],
            [Markup.button.callback('🎥 Total Videos', 'admin_total_videos')],
            [Markup.button.callback('📂 Data', 'admin_data')],
            [Markup.button.callback('🕒 Pending Verification', 'admin_pending_verification')],
            [Markup.button.callback('🌟 Premium Users', 'admin_premium_users')],
            [Markup.button.callback('🚫 Remove Premium', 'admin_remove_premium')],
            [Markup.button.callback('🔨 Ban Users', 'admin_ban_users')]
        ])
    );

    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('admin_broadcast', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const reply = await ctx.reply('Enter the message or video to broadcast:');
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('admin_total_users', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const totalUsers = userIds.length;
    const reply = await ctx.reply(`Total Users: ${totalUsers}`);
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('admin_total_videos', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const totalVideos = videos.length;
    const reply = await ctx.reply(`Total Videos: ${totalVideos}`);
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('admin_data', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    try {
        await ctx.telegram.sendDocument(ctx.chat.id, { source: USERS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: VIDEOS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: PENDING_REQUESTS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: USER_IDS_FILE });
        await ctx.telegram.sendDocument(ctx.chat.id, { source: PREMIUM_USERS_FILE });
    } catch (error) {
        console.error('Error sending data:', error);
        const reply = await ctx.reply('❌ Failed to send data files.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
    }
});

bot.action('admin_pending_verification', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    if (pendingRequests.length === 0) {
        const reply = await ctx.reply('No pending verification requests.');
        deleteAfterDelay(ctx.chat.id, reply.message_id);
        return;
    }

    for (const request of pendingRequests) {
        await ctx.telegram.sendPhoto(ctx.chat.id, request.photo, {
            caption: `User ID: ${request.userId}`,
        });
    }
});

bot.action('admin_premium_users', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const premiumUserNames = premiumUsers.map(id => users[id].name).join(', ');
    const reply = await ctx.reply(`Premium Users: ${premiumUserNames}`);
    deleteAfterDelay(ctx.chat.id, reply.message_id);
});

bot.action('admin_remove_premium', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const reply = await ctx.reply('Enter the user ID to remove premium status:');
    deleteAfterDelay(ctx.chat.id, reply.message_id);

    bot.on('text', async (replyCtx) => {
        const userId = replyCtx.message.text;
        if (users[userId]) {
            removePremium(userId);
            await ctx.reply(`✅ Premium status removed for user: ${users[userId].name}`);
        } else {
            await ctx.reply('❌ User not found.');
        }
    });
});

bot.action('admin_ban_users', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;

    const reply = await ctx.reply('Enter the user ID to ban:');
    deleteAfterDelay(ctx.chat.id, reply.message_id);

    bot.on('text', async (replyCtx) => {
        const userId = replyCtx.message.text;
        if (users[userId]) {
            banUser(userId);
            await ctx.reply(`✅ User ${users[userId].name} has been banned.`);
        } else {
            await ctx.reply('❌ User not found.');
        }
    });
});

bot.launch();
