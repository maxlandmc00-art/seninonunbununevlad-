const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const USERS_FILE = './users.json';
const FRIENDS_FILE = './friends.json';

const readJSON = (file) => {
    if (!fs.existsSync(file)) return file === USERS_FILE ? { users: [] } : {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return file === USERS_FILE ? { users: [] } : {};
    }
};
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 4));

if (!fs.existsSync('./messages')) fs.mkdirSync('./messages');

let sessionUser = null;
let typingUsers = {};

// --- ANA DİZİN YÖNLENDİRMESİ (Hata buradaydı) ---
app.get('/', (req, res) => {
    if (sessionUser) res.redirect('/app');
    else res.redirect('/auth');
});

// --- AUTH SAYFASI ---
app.get('/auth', (req, res) => {
    res.render('auth'); // views/auth.ejs dosyanın olduğundan emin ol
});

app.post('/register', (req, res) => {
    const { email, username, password } = req.body;
    let data = readJSON(USERS_FILE);
    const newUser = { email, username, password, tag: "#" + Math.floor(1000 + Math.random() * 9000) };
    data.users.push(newUser);
    writeJSON(USERS_FILE, data);
    sessionUser = newUser;
    res.redirect('/app');
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = readJSON(USERS_FILE).users.find(u => u.email === email && u.password === password);
    if (user) { 
        sessionUser = user; 
        res.redirect('/app'); 
    } else {
        res.send("Giriş bilgileri hatalı. <a href='/auth'>Geri dön</a>");
    }
});

// --- APP ANA SAYFA ---
app.get('/app', (req, res) => {
    if (!sessionUser) return res.redirect('/auth');
    const allFriends = readJSON(FRIENDS_FILE);
    const myData = allFriends[sessionUser.email] || { friends: [], pending: [] };
    res.render('app', { 
        friends: myData.friends, 
        pending: myData.pending, 
        user: sessionUser, 
        activeTab: req.query.tab || 'online' 
    });
});

// --- TYPING API ---
app.post('/api/typing', (req, res) => {
    if (!sessionUser) return res.sendStatus(401);
    const { target, isTyping } = req.body;
    if (isTyping) typingUsers[sessionUser.username] = target;
    else delete typingUsers[sessionUser.username];
    res.sendStatus(200);
});

app.get('/api/typing-status/:target', (req, res) => {
    if (!sessionUser) return res.sendStatus(401);
    const writer = req.params.target;
    const isTyping = typingUsers[writer] === sessionUser.username;
    res.json({ isTyping });
});

// --- ARKADAŞLIK VE DM İŞLEMLERİ ---
app.post('/api/close-dm', (req, res) => {
    if (!sessionUser) return res.sendStatus(401);
    const { target } = req.body;
    let allFriends = readJSON(FRIENDS_FILE);
    const myData = allFriends[sessionUser.email];
    if (myData && myData.friends) {
        const friend = myData.friends.find(f => f.username === target);
        if (friend) { friend.hidden = true; writeJSON(FRIENDS_FILE, allFriends); }
    }
    res.json({ success: true });
});

app.post('/add-friend', (req, res) => {
    if (!sessionUser) return res.redirect('/auth');
    const { targetUser } = req.body;
    const users = readJSON(USERS_FILE).users;
    const targetAccount = users.find(u => u.username.toLowerCase() === targetUser.toLowerCase());
    let allFriends = readJSON(FRIENDS_FILE);

    if (targetAccount && targetAccount.email !== sessionUser.email) {
        if (!allFriends[sessionUser.email]) allFriends[sessionUser.email] = { friends: [], pending: [] };
        const isAlready = allFriends[sessionUser.email].friends.find(f => f.username === targetAccount.username);
        
        if (isAlready) {
            isAlready.hidden = false;
            writeJSON(FRIENDS_FILE, allFriends);
            return res.redirect(`/app?tab=add&status=already&target=${targetAccount.username}`);
        }

        const reqId = Date.now().toString();
        if (!allFriends[targetAccount.email]) allFriends[targetAccount.email] = { friends: [], pending: [] };
        allFriends[targetAccount.email].pending.push({ id: reqId, username: sessionUser.username, sender: sessionUser.username });
        allFriends[sessionUser.email].pending.push({ id: reqId, username: targetAccount.username, sender: sessionUser.username });
        writeJSON(FRIENDS_FILE, allFriends);
    }
    res.redirect('/app?tab=pending');
});

app.post('/accept-friend', (req, res) => {
    if (!sessionUser) return res.redirect('/auth');
    const { requestId } = req.body;
    let allFriends = readJSON(FRIENDS_FILE);
    const myData = allFriends[sessionUser.email];
    const request = myData.pending.find(p => p.id === requestId);

    if (request) {
        const otherUser = readJSON(USERS_FILE).users.find(u => u.username === request.username);
        if (!myData.friends.find(f => f.username === request.username)) {
            myData.friends.push({ username: request.username, hidden: false });
            if (!allFriends[otherUser.email]) allFriends[otherUser.email] = { friends: [], pending: [] };
            allFriends[otherUser.email].friends.push({ username: sessionUser.username, hidden: false });
        }
        for (let email in allFriends) {
            allFriends[email].pending = (allFriends[email].pending || []).filter(p => p.id !== requestId);
        }
        writeJSON(FRIENDS_FILE, allFriends);
    }
    res.redirect('/app?tab=all');
});

// --- MESAJLAR ---
app.post('/api/send-message', (req, res) => {
    if (!sessionUser) return res.sendStatus(401);
    const { target, message } = req.body;
    const chatRoom = [sessionUser.username, target].sort().join('-');
    const dir = `./messages/${chatRoom}`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = `${dir}/chat.json`;
    const msgs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    msgs.push({ sender: sessionUser.username, text: message, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) });
    fs.writeFileSync(file, JSON.stringify(msgs, null, 4));

    // Karşı tarafın DM kutusunda gizliyse aç
    let allFriends = readJSON(FRIENDS_FILE);
    const other = readJSON(USERS_FILE).users.find(u => u.username === target);
    if (other && allFriends[other.email]) {
        const rec = allFriends[other.email].friends.find(f => f.username === sessionUser.username);
        if (rec) rec.hidden = false;
        writeJSON(FRIENDS_FILE, allFriends);
    }
    res.json({ success: true });
});

app.get('/api/chat/:target', (req, res) => {
    if (!sessionUser) return res.sendStatus(401);
    const chatRoom = [sessionUser.username, req.params.target].sort().join('-');
    const file = `./messages/${chatRoom}/chat.json`;
    res.json(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
});

app.get('/logout', (req, res) => { sessionUser = null; res.redirect('/auth'); });

app.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} adresinde aktif!`));