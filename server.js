const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ADMIN PIN設定
const ADMIN_PIN = "1234";

// データ保持
let slots = []; // { id, time, capacity, booked }
let reservations = []; // { id, slotId, time, userId, displayName, count }
let currentSlotIndex = 0;

// ルーティング
app.get('/reserve', (req, res) => res.sendFile(__dirname + '/public/reserve.html'));
app.get('/monitor', (req, res) => res.sendFile(__dirname + '/public/monitor.html'));
app.get('/admin/login', (req, res) => res.sendFile(__dirname + '/public/admin-login.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));

// API: 枠・予約データ取得
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

// API: 予約実行（テキスト＋QRコード画像送信機能）
app.post('/api/reserve', async (req, res) => {
  const { slotId, userId, displayName, count } = req.body;
  const slot = slots.find(s => s.id === parseInt(slotId));
  if (!slot) return res.json({ success: false, error: '枠が存在しません' });

  const reserveCount = parseInt(count) || 1;
  if ((slot.booked + reserveCount) > slot.capacity) {
    return res.json({ success: false, error: '残り人数を超えています' });
  }

  slot.booked += reserveCount;
  const reservationId = Date.now();
  const newReservation = {
    id: reservationId,
    slotId: slot.id,
    time: slot.time,
    userId,
    displayName: displayName || 'ゲスト',
    count: reserveCount
  };
  reservations.push(newReservation);

  // LINEユーザーIDとアクセストークンがある場合にテキスト＋QRコード画像を送る
  if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    try {
      console.log(`[LINE送信開始] 宛先userId: ${userId}`);
      
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${reservationId}`;

      const lineRes = await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [
          {
            type: 'text',
            text: `【『LINK』予約完了通知】\n\nご予約ありがとうございます！\n\n■ 予約時間: ${slot.time}\n■ 予約人数: ${reserveCount}名\n■ 予約ID: ${reservationId}\n\n当日、下のQRコードまたは予約IDをスタッフにお見せください。`
          },
          {
            type: 'image',
            originalContentUrl: qrCodeUrl,
            previewImageUrl: qrCodeUrl
          }
        ]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        }
      });
      console.log('[LINE送信成功]', lineRes.data);
    } catch (err) {
      console.error('★LINE送信エラー詳細:', err.response?.data || err.message);
    }
  } else {
    console.log('[LINE送信スキップ] userIdがないか、トークンが未設定です。 userId:', userId);
  }

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
    if (slot && slot.booked >= target.count) slot.booked -= target.count;
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