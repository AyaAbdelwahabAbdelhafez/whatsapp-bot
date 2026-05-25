const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const socketIO = require('socket.io');
const http = require('http');
const qrcode = require('qrcode');
const cron = require('node-cron');
const mime = require('mime-types');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });
const CAMPAIGNS_FILE = './campaigns.json';
let campaigns = [];
let client = null;
let isReady = false;

// ------------------- تحميل وحفظ الحملات -------------------
async function loadCampaigns() {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
        campaigns = await fs.readJson(CAMPAIGNS_FILE);
    } else {
        campaigns = [];
    }
    // تعيين القيم الافتراضية للحملات القديمة
    campaigns.forEach(c => {
        if (c.minDelay === undefined) c.minDelay = 5;
        if (c.maxDelay === undefined) c.maxDelay = 15;
    });
    await saveCampaigns();
}
async function saveCampaigns() {
    await fs.writeJson(CAMPAIGNS_FILE, campaigns);
}

// ------------------- جلب الجروبات مع إعادة المحاولة -------------------
async function fetchGroupsWithRetry(retries = 3, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            if (!client || !client.info) throw new Error('Client not ready');
            console.log(`Fetching groups attempt ${i + 1}...`);
            const chats = await client.getChats();
            const groups = chats.filter(chat => chat.isGroup).map(chat => ({
                id: chat.id._serialized,
                name: chat.name
            }));
            if (groups.length > 0 || i === retries - 1) {
                console.log(`Found ${groups.length} groups`);
                return groups;
            }
            console.log(`No groups yet, retrying (${i + 1}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        } catch (err) {
            console.error(`Attempt ${i + 1} failed:`, err.message);
            if (i === retries - 1) return [];
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return [];
}

// ------------------- إعداد عميل الواتساب -------------------
client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 90000
    },
    qrTimeout: 60000,
    clientOptions: { waitForInitialization: true }
});

client.on('qr', async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit('qr', qrImage);
    console.log('📱 QR code generated. Scan it on WhatsApp.');
});

client.on('ready', async () => {
    console.log('✅ WhatsApp bot is ready!');
    isReady = true;
    io.emit('ready', true);
    setTimeout(async () => {
        await sendMissedCampaigns();
        startScheduler();
        const groups = await fetchGroupsWithRetry();
        io.emit('groups_ready', groups);
    }, 5000);
});

client.on('auth_failure', () => {
    isReady = false;
    io.emit('ready', false);
    console.log('❌ Authentication failed. Restart and scan QR again.');
});

client.initialize();

// ------------------- دالة إرسال الصورة بشكل صحيح -------------------
function getValidMedia(imagePath) {
    if (!imagePath || !fs.existsSync(imagePath)) return null;
    const mimeType = mime.lookup(imagePath) || 'image/jpeg';
    const base64 = fs.readFileSync(imagePath, { encoding: 'base64' });
    return new MessageMedia(mimeType, base64);
}

// ------------------- تنفيذ حملة مع تأخير عشوائي -------------------
async function executeCampaign(campaign) {
    if (!isReady) {
        console.log(`⏳ Bot not ready, cannot execute: ${campaign.name}`);
        return false;
    }
    try {
        const groups = campaign.groups;
        let media = null;
        if (campaign.imagePath && fs.existsSync(campaign.imagePath)) {
            media = getValidMedia(campaign.imagePath);
            if (!media) console.warn(`Invalid image for campaign ${campaign.name}`);
        }
        const minDelay = campaign.minDelay || 5;
        const maxDelay = campaign.maxDelay || 15;
        for (let idx = 0; idx < groups.length; idx++) {
            const group = groups[idx];
            try {
                if (media) {
                    await client.sendMessage(group.id, media, { caption: campaign.message });
                } else {
                    await client.sendMessage(group.id, campaign.message);
                }
                console.log(`✅ Sent "${campaign.name}" to ${group.name}`);
            } catch (err) {
                console.error(`❌ Failed to send to ${group.name}:`, err.message);
            }
            // تأخير عشوائي بين كل جروب وآخر (ما عدا آخر واحد)
            if (idx < groups.length - 1) {
                const delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
                console.log(`⏳ Waiting ${delaySec} seconds before next group...`);
                await new Promise(r => setTimeout(r, delaySec * 1000));
            }
        }
        campaign.executed = true;
        campaign.executedAt = new Date().toISOString();
        await saveCampaigns();
        io.emit('campaigns_updated', campaigns);
        return true;
    } catch (err) {
        console.error(`❌ Campaign execution error ${campaign.name}:`, err.message);
        return false;
    }
}

async function checkAndExecute() {
    const now = new Date();
    for (const camp of campaigns) {
        if (camp.enabled && !camp.executed && camp.scheduleDate) {
            const scheduled = new Date(camp.scheduleDate);
            if (scheduled <= now) {
                console.log(`🕒 Executing scheduled campaign: ${camp.name}`);
                await executeCampaign(camp);
            }
        }
    }
}

async function sendMissedCampaigns() {
    for (const camp of campaigns) {
        if (camp.enabled && !camp.executed && camp.scheduleDate && new Date(camp.scheduleDate) <= new Date()) {
            await executeCampaign(camp);
        }
    }
}

function startScheduler() {
    cron.schedule('* * * * *', async () => {
        if (isReady) await checkAndExecute();
    });
    console.log('⏰ Scheduler started (checks every minute).');
}

// ------------------- API -------------------
app.get('/api/campaigns', async (req, res) => {
    await loadCampaigns();
    res.json(campaigns);
});

app.get('/api/groups', async (req, res) => {
    if (!isReady || !client) return res.json([]);
    const groups = await fetchGroupsWithRetry();
    res.json(groups);
});

app.post('/api/campaigns', upload.single('image'), async (req, res) => {
    await loadCampaigns();
    const { name, message, scheduleDate, groups, minDelay, maxDelay } = req.body;
    if (!name || !message || !scheduleDate) {
        return res.status(400).json({ error: 'Name, message, and schedule date are required.' });
    }
    let imagePath = null;
    if (req.file) imagePath = req.file.path;
    const newCampaign = {
        id: Date.now().toString(),
        name,
        message,
        scheduleDate,
        groups: JSON.parse(groups),
        imagePath,
        enabled: true,
        executed: false,
        executedAt: null,
        createdAt: new Date().toISOString(),
        minDelay: parseInt(minDelay) || 5,
        maxDelay: parseInt(maxDelay) || 15
    };
    campaigns.push(newCampaign);
    await saveCampaigns();
    io.emit('campaigns_updated', campaigns);
    res.json({ success: true, campaign: newCampaign });
});

app.put('/api/campaigns/:id', upload.single('image'), async (req, res) => {
    await loadCampaigns();
    const id = req.params.id;
    const index = campaigns.findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ error: 'Campaign not found' });
    const { name, message, scheduleDate, groups, enabled, minDelay, maxDelay } = req.body;
    if (name) campaigns[index].name = name;
    if (message) campaigns[index].message = message;
    if (scheduleDate) campaigns[index].scheduleDate = scheduleDate;
    if (groups) campaigns[index].groups = JSON.parse(groups);
    if (enabled !== undefined) campaigns[index].enabled = (enabled === 'true' || enabled === true);
    if (minDelay) campaigns[index].minDelay = parseInt(minDelay);
    if (maxDelay) campaigns[index].maxDelay = parseInt(maxDelay);
    if (req.file) {
        if (campaigns[index].imagePath && fs.existsSync(campaigns[index].imagePath))
            await fs.remove(campaigns[index].imagePath);
        campaigns[index].imagePath = req.file.path;
    }
    campaigns[index].executed = false;
    campaigns[index].executedAt = null;
    await saveCampaigns();
    io.emit('campaigns_updated', campaigns);
    res.json({ success: true });
});

app.delete('/api/campaigns/:id', async (req, res) => {
    await loadCampaigns();
    const id = req.params.id;
    const campaign = campaigns.find(c => c.id === id);
    if (campaign && campaign.imagePath && fs.existsSync(campaign.imagePath))
        await fs.remove(campaign.imagePath);
    campaigns = campaigns.filter(c => c.id !== id);
    await saveCampaigns();
    io.emit('campaigns_updated', campaigns);
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({ ready: isReady });
});

app.get('/api/refresh-groups', async (req, res) => {
    if (!isReady) return res.json([]);
    const groups = await fetchGroupsWithRetry(5, 2000);
    res.json(groups);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    await loadCampaigns();
});