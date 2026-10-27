require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const line = require('@line/bot-sdk');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy',
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy'
};
const lineClient = new line.messagingApi.MessagingApiClient(lineConfig);

let timeSlots = [];

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/api/admin/slots', (req, res) => {
  const { time, capacity } = req.body;
  const newSlot = { id: Date.now(), time, capacity: parseInt(capacity), booked: 0 };
  timeSlots.push(newSlot);
  io.emit('slots-updated', timeSlots);
  res.json({ success: true, slot: newSlot });
});

app.post('/api/reserve', async (req, res) => {
  const { slotId } = req.body;
  const slot = timeSlots.find(s => s.id === parseInt(slotId));
  if (!slot) return res.status(404).json({ error: '枠が見つかりません' });
  if (slot.booked >= slot.capacity) return res.status(400).json({ error: '満員です' });
  slot.booked += 1;
  io.emit('slots-updated', timeSlots);
  res.json({ success: true, slot });
});

app.get('/api/slots', (req, res) => res.json(timeSlots));

io.on('connection', (socket) => {
  socket.emit('slots-updated', timeSlots);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});