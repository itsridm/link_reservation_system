const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const line = require('@line/bot-sdk');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ADMIN PIN設定（必要に応じて変更してください）
const ADMIN_PIN = "1234";

// データ保持（本番ではDB推奨）
let slots = []; // { id, time, capacity, booked, current: false }
let reservations = []; // { id, slotId, time, userId, displayName }
let currentSlotIndex = 0;

// ルーティング
app.get('/reserve', (req, res) => res.sendFile(__dirname + '/public/reserve.html'));
app.get('/monitor', (req, res) => res.sendFile(__dirname + '/public/monitor.html'));
app.get('/admin/login', (req, res) => res.sendFile(__dirname + '/public/admin-login.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));

// API: 枠・予約取得
app.get('/api/data', (req, res) => {
  res.json({ slots, reservations, currentSlotIndex });
});

// API: 管理者ログイン認証
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'PINが正しくありません' });
  }
});

// API: 枠作成
app.post('/api/admin/slots', (req, res) => {
  const { time, capacity } = req.body;
  const newSlot = {
    id: Date.now(),
    time,
    capacity: parseInt(capacity),
    booked: 0
  };
  slots.push(newSlot);
  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true });
});

// API: 枠削除
app.delete('/api/admin/slots/:id', (req, res) => {
  const id = parseInt(req.params.id);
  slots = slots.filter(s => s.id !== id);
  reservations = reservations.filter(r => r.slotId !== id);
  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true });
});

// API: 予約実行
app.post('/api/reserve', (req, res) => {
  const { slotId, userId, displayName } = req.body;
  const slot = slots.find(s => s.id === parseInt(slotId));
  if (!slot) return res.json({ success: false, error: '枠が存在しません' });
  if (slot.booked >= slot.capacity) return res.json({ success: false, error: '満員です' });

  slot.booked += 1;
  const newReservation = {
    id: Date.now(),
    slotId: slot.id,
    time: slot.time,
    userId,
    displayName: displayName || 'ゲスト'
  };
  reservations.push(newReservation);

  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true, reservation: newReservation });
});

// API: 予約削除（管理者用）
app.delete('/api/admin/reservations/:id', (req, res) => {
  const resId = parseInt(req.params.id);
  const targetIndex = reservations.findIndex(r => r.id === resId);
  if (targetIndex !== -1) {
    const target = reservations[targetIndex];
    const slot = slots.find(s => s.id === target.slotId);
    if (slot && slot.booked > 0) slot.booked -= 1;
    reservations.splice(targetIndex, 1);
    io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  }
  res.json({ success: true });
});

// API: 進行管理（次の枠に進む）
app.post('/api/admin/next-slot', (req, res) => {
  if (currentSlotIndex < slots.length - 1) {
    currentSlotIndex += 1;
    io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  }
  res.json({ success: true, currentSlotIndex });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));