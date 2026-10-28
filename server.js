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

const ADMIN_PIN = "1234";

let slots = [];
let reservations = [];
let currentSlotIndex = 0;

app.get('/reserve', (req, res) => res.sendFile(__dirname + '/public/reserve.html'));
app.get('/monitor', (req, res) => res.sendFile(__dirname + '/public/monitor.html'));
app.get('/admin/login', (req, res) => res.sendFile(__dirname + '/public/admin-login.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));
app.get('/manager', (req, res) => res.sendFile(__dirname + '/public/manager.html'));
app.get('/scanner', (req, res) => res.sendFile(__dirname + '/public/scanner.html'));

// 全データ取得（管理者画面用：全枠・全予約を返却）
app.get('/api/data', (req, res) => {
  res.json({ slots, reservations, currentSlotIndex });
});

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) res.json({ success: true });
  else res.json({ success: false, error: 'PINが正しくありません' });
});

app.post('/api/admin/slots', (req, res) => {
  const { time, capacity } = req.body;
  slots.push({ id: Date.now(), time, capacity: parseInt(capacity), booked: 0 });
  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true });
});

app.delete('/api/admin/slots/:id', (req, res) => {
  const id = parseInt(req.params.id);
  slots = slots.filter(s => s.id !== id);
  reservations = reservations.filter(r => r.slotId !== id);
  if (currentSlotIndex >= slots.length && slots.length > 0) currentSlotIndex = slots.length - 1;
  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true });
});

// API: 次の枠へ進行（currentSlotIndex を進める。枠自体は削除せず保持）
app.post('/api/admin/next-slot', (req, res) => {
  if (slots.length === 0) return res.json({ success: false, error: '枠が登録されていません' });

  if (currentSlotIndex < slots.length - 1) {
    currentSlotIndex++;
    // クライアント側に更新イベントを発行（クライアント側で currentSlotIndex 以降の枠のみフィルタリング表示する）
    io.emit('slots-updated', { slots, reservations, currentSlotIndex });
    res.json({ success: true, currentSlotIndex });
  } else {
    res.json({ success: false, error: 'これ以上先の枠はありません' });
  }
});

// API: LINE呼び出し（リマインド送信）
app.post('/api/admin/call-slot', async (req, res) => {
  const { slotId } = req.body;
  const slot = slots.find(s => s.id === parseInt(slotId));
  if (!slot) return res.json({ success: false, error: '指定された枠が見つかりません' });

  const targetReservations = reservations.filter(r => r.slotId === slot.id && r.userId);
  if (targetReservations.length === 0) {
    return res.json({ success: false, error: 'この枠にLINE連携済みの予約者がいません' });
  }

  let sentCount = 0;
  for (const r of targetReservations) {
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
          to: r.userId,
          messages: [{
            type: 'text',
            text: `【『LINK』呼び出し通知】\n\nまもなく ${slot.time} の体験枠のご案内時間となります！\n受付ブースまでお越しください。\n\n■ 予約ID: ${r.id}`
          }]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          }
        });
        sentCount++;
      } catch (err) {
        console.error('LINE呼び出し送信エラー:', err.response?.data || err.message);
      }
    }
  }

  res.json({ success: true, sentCount });
});

app.post('/api/admin/check-in', (req, res) => {
  const { reservationId } = req.body;
  const target = reservations.find(r => r.id === parseInt(reservationId));
  if (!target) return res.json({ success: false, error: '該当する予約IDが見つかりません' });

  target.checked = true;
  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true, reservation: target });
});

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
    count: reserveCount,
    checked: false
  };
  reservations.push(newReservation);

  if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    try {
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${reservationId}`;
      await axios.post('https://api.line.me/v2/bot/message/push', {
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
    } catch (err) {
      console.error('★LINE送信エラー:', err.response?.data || err.message);
    }
  }

  io.emit('slots-updated', { slots, reservations, currentSlotIndex });
  res.json({ success: true, reservation: newReservation });
});

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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));