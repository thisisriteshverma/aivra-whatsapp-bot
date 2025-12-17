import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import express from "express";
import pino from "pino";

let sock;

/* ============================================================
   💖 MESSAGE TEMPLATES
   (Merged: Loving Customer Messages + Seller Alerts)
============================================================ */
const orderMessages = {
    // 1. Order Placed (Customer) - High energy, validation
    // Adapted to handle 'items' string containing quantity info if needed
    orderSuccess: (name, id, items, amount, payment) =>
`👋 *Hi ${name}!*

💖 *You’ve got amazing taste!*
Thanks so much for choosing us. We are absolutely thrilled to receive your order!

━━━━━━━━━━━━━━━━━━━━
🧾 *YOUR ORDER SUMMARY*
━━━━━━━━━━━━━━━━━━━━
🆔 *Order ID:* #${id}
🛍️ *Items:*
${items}

💰 *Total Value:* ₹${amount}
💳 *Payment:* ${payment}
━━━━━━━━━━━━━━━━━━━━

🚀 We are getting everything ready to fly to you. You'll hear from us soon!
_Questions? Just reply here. We're always happy to chat!_ 💬`,

    // 2. New Order Alert (Seller) - Clean & Efficient
    orderReceivedSeller: (id, customer, phone, items, amount, payment) =>
`🔔 *New Order Alert!*

🆔 *Order ID:* #${id}
👤 *Customer:* ${customer}
📞 *Contact:* +${phone}

📦 *Order Details:*
${items}

💰 *Total:* ₹${amount}
💳 *Payment:* ${payment}

👉 _Please check your dashboard to process this order._`,

    // 3. Accepted
    accepted: (id) => 
`🌟 *Order Confirmed!*

Great news! Your Order *#${id}* has been officially accepted. ✅ 
Our team has received your details and we are getting to work immediately.

Sit tight, we'll handle the rest! 🛋️`,

    // 4. Processing
    processing: (id) => 
`🎁 *Packing with Love...*

Just a quick update: Your Order *#${id}* is currently being packed! 
We are checking everything carefully to ensure it reaches you in perfect condition. ✨`,

    // 5. Shipped (With Tracking)
    shippedWithTrack: (id, partner, trackId) =>
`🚀 *Your Happiness is on the Way!*

Exciting news! Your Order *#${id}* has left our facility. 

📦 *Courier Partner:* ${partner}
🔗 *Tracking Number:* ${trackId}

You can track your package using the ID above. It won't be long now! ⏳`,

    // 6. Shipped (Generic)
    shippedGeneric: (id) =>
`🚀 *Your Happiness is on the Way!*

Exciting news! Your Order *#${id}* has been shipped and is speeding towards you. 🛣️

Keep your phone close, delivery is around the corner!`,

    // 7. Delivered (Customer)
    delivered: (id) => 
`🎉 *Knock Knock! It’s Here!*

Your Order *#${id}* has been delivered! 🥳

We truly hope this package brightens your day. Thank you for being a part of our family. 
If you love it, let us know! 💙`,

    // 8. Delivered (Seller)
    deliveredSeller: (id) =>
`✅ *Order Delivered*

Order *#${id}* has been successfully delivered to the customer.`,

    // 9. Cancelled (Customer)
    cancelled: (id) => 
`💔 *Order Status Update*

Your Order *#${id}* has been cancelled. 
We're sad to see this go, but we understand things happen! 

If this was a mistake or if you'd like to order again, we are just a message away. 🙏`,

    // 10. Cancelled (Seller)
    cancelledSeller: (id) =>
`❌ *Order Cancelled*

Order *#${id}* has been cancelled.
No further action needed.`
};

/* ============================================================
   🤖 START WHATSAPP BOT
============================================================ */
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");

    sock = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: true,
        auth: state,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log("⚠️ Connection closed. Reconnecting...");
                startBot();
            } else {
                console.log("❌ Logged out. Scan QR again.");
            }
        }
        if (connection === "open") {
            console.log("✅ WhatsApp Bot Connected!");
        }
    });
}

startBot();

/* ============================================================
   🚀 EXPRESS SERVER + CORS
============================================================ */
const app = express();

// Add CORS Middleware (from File 2)
app.use((req, res, next) => {
    const allowedOrigin = req.headers.origin || "*"; 
    res.header("Access-Control-Allow-Origin", allowedOrigin);
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

app.use(express.json());

/* ============================================================
   🛠️ HELPERS
============================================================ */
function sanitizeNumber(num) {
    let clean = num.toString().replace(/\D/g, "");
    // Remove '91' prefix if length is greater than 10 so we can re-add it safely, 
    // or just ensure it starts with 91.
    // Simple logic: if it's 10 digits, add 91. If it's 12 and starts with 91, keep it.
    if (clean.length === 10) {
        clean = "91" + clean;
    } else if (clean.length > 10 && !clean.startsWith("91")) {
        clean = "91" + clean; // Fallback
    } else if (clean.length > 12 && clean.startsWith("91")) {
         clean = clean.slice(0, 12); // Truncate if too long (rare edge case)
    }

    // Ensure it starts with 91 if it doesn't yet (extra safety)
    if (!clean.startsWith("91")) clean = "91" + clean;

    return clean;
}

async function sendWhatsApp(number, message) {
    const clean = sanitizeNumber(number);
    const jid = clean + "@s.whatsapp.net";

    console.log(`📨 Sending to ${clean}...`);

    // Artificial delay to prevent spam flagging
    await new Promise(r => setTimeout(r, 1000)); 

    return sock.sendMessage(jid, { text: message });
}

/* ============================================================
   🔗 ROUTES
============================================================ */

// 1. Order Success (Triggered on Checkout)
// Sends to BOTH Customer and Seller
app.post("/order-success", async (req, res) => {
    const { 
        number,       // buyer phone
        sellerNumber, // seller phone
        name,         // buyer name
        orderId, 
        items,        // item list string (or formatted string)
        amount, 
        paymentMode 
    } = req.body;

    try {
        // A. Send to CUSTOMER
        await sendWhatsApp(
            number,
            orderMessages.orderSuccess(name, orderId, items, amount, paymentMode)
        );

        // B. Send to SELLER (if number exists)
        if (sellerNumber) {
            await sendWhatsApp(
                sellerNumber,
                orderMessages.orderReceivedSeller(
                    orderId,
                    name,
                    number,
                    items,
                    amount,
                    paymentMode
                )
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.log("❌ order-success error:", err);
        res.json({ success: false, error: String(err) });
    }
});

// 2. Order Status Updates (Triggered from Dashboard)
app.post("/order-status", async (req, res) => {
    console.log("🔥 ORDER STATUS HIT:", req.body);

    // Added sellerNumber destructuring
    let { number, sellerNumber, status, orderId, shippingPartner, trackingId } = req.body;
    status = String(status).toLowerCase().trim();

    if (!number || !status || !orderId)
        return res.json({ success: false, error: "Missing fields" });

    try {
        // --- 1. SEND CUSTOMER MESSAGE ---
        let customerMsg = "";

        if (status === "shipped") {
            if (shippingPartner && trackingId) {
                customerMsg = orderMessages.shippedWithTrack(orderId, shippingPartner, trackingId);
            } else {
                customerMsg = orderMessages.shippedGeneric(orderId);
            }
        } else {
            if (!orderMessages[status])
                return res.json({ success: false, error: "Unknown status" });

            customerMsg = orderMessages[status](orderId);
        }

        await sendWhatsApp(number, customerMsg);


        // --- 2. SEND SELLER NOTIFICATION (for Delivered/Cancelled) ---
        const cleanSeller = sellerNumber && String(sellerNumber).trim();
        if (cleanSeller) {
            if (status === "delivered") {
                await sendWhatsApp(cleanSeller, orderMessages.deliveredSeller(orderId));
            }
            if (["cancelled", "canceled", "cancel"].includes(status)) {
                await sendWhatsApp(cleanSeller, orderMessages.cancelledSeller(orderId));
            }
        } else {
            console.warn("⚠️ Seller number missing for order:", orderId);
        }

        res.json({ success: true });
    } catch (err) {
        console.log("❌ order-status error:", err);
        res.json({ success: false, error: String(err) });
    }
});

/* ============================================================
   🏁 START SERVER
============================================================ */
const PORT = 5000;
app.listen(PORT, "0.0.0.0", () =>
    console.log(`🌍 WhatsApp Bot API running on ${PORT}`)
);
