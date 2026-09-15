// =============================================================================
// email-queue.js -> Redis ki "List" data structure ko ek simple Email Queue
// ki tarah use karna dikhata hai. Ye ek important Redis pattern hai —
// background jobs / async processing (jaise emails, notifications) ke liye
// real systems me aksar isi tarah ka queue banaya jata hai.
// =============================================================================
// Idea: Jab koi email "bhejna" ho, hum use turant SMTP se nahi bhejte
// (jo slow ho sakta hai aur request ko block kar sakta hai) — balki use
// Redis List me push kar dete hain aur turant response de dete hain. Ek
// alag "worker" process (yahan humne worker nahi banaya, sirf queue ka demo
// hai) baad me is list se emails nikaal ke actually bhej sakta hai. Isse
// request fast rehti hai aur email sending decoupled ho jata hai.
//
// Redis List FIFO (First In, First Out) queue ki tarah kaam karti hai agar
// hum consistently ek taraf se PUSH aur doosri taraf se POP karein:
//   LPUSH -> list ke LEFT (start) me naya item daalta hai
//   RPOP  -> list ke RIGHT (end) se item nikalta hai
// Matlab sabse PEHLE push hua email, sabse LAST me RPOP hoga — yahi FIFO
// order hai (jo email pehle aaya, wahi pehle process hota hai).
//
// Iske liye 4 routes hain:
//   POST /email/send          -> naya email queue me daalo (LPUSH)
//   GET  /email/queue         -> saare queued emails dekho (bina hataye)
//   GET  /email/queue/count   -> queue me kitne emails pending hain
//   GET  /email/queue/next    -> agla email queue se nikaalo aur process karo
// =============================================================================

import { Router } from "express";

// Saare routes isi ek Redis List key ko use karte hain. Ek jagah define
// karke reuse kar rahe hain, taaki kahin par bhi spelling mistake se do
// alag keys na ban jayein. Naming "namespace:entity" (jaise "site:banner",
// "otp:<phone>") is project ke Redis key naming convention ke saath
// consistent rakhne ke liye colon-separated lowercase rakha hai.
const EMAIL_QUEUE_KEY = 'email:queue';

export const emailQueueRouter = (redis) => {
    const router = Router();

    // -------------------------------------------------------------------
    // @route   POST /email/send
    // @desc    Naya email Redis List me push karta hai (queue me daal deta
    //          hai) — actual email yahan turant nahi bhejta, sirf queue
    //          karta hai. `createdAt` timestamp bhi save karte hain, taaki
    //          baad me pata chal sake ki email kab queue hua tha.
    // @body    { "to": "...", "subject": "...", "body": "..." }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/email/send', async(req, res) => {
        try {
            const { to, subject, body } = req.body;

            if (!to || !subject || !body) {
                return res.status(400).json({error: 'To, subject, and body are required'});
            }

            // Redis me email ko ek list ke roop me push kar rahe hain
            await redis.lpush(EMAIL_QUEUE_KEY, JSON.stringify({ to, subject, body, createdAt: new Date().toISOString() }));
            res.status(200).json({message: 'Email queued successfully'});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    // -------------------------------------------------------------------
    // @route   GET /email/queue
    // @desc    Queue me abhi jitne bhi emails pending hain, sabko dikhata
    //          hai — ye sirf "peek" hai, `lrange` list se kuch remove
    //          NAHI karta, isliye baar-baar call karne par same result
    //          milega (jab tak koi naya email add/process na ho).
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/email/queue', async(req, res) => {
        try {
            // Redis list se saare queued emails fetch kar rahe hain
            // "0, -1" ka matlab hai poori list (start se end tak)
            const queuedEmails = await redis.lrange(EMAIL_QUEUE_KEY, 0, -1);
            const emails = queuedEmails.map(email => JSON.parse(email));
            res.status(200).json({emails});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    // -------------------------------------------------------------------
    // @route   GET /email/queue/count
    // @desc    Queue me kitne emails pending hain, sirf count batata hai.
    //          `llen` O(1) operation hai (list ki length Redis khud track
    //          rakhta hai), isliye `lrange` se poori list fetch karke
    //          `.length` nikalne se kahin zyada fast/cheap hai.
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/email/queue/count', async(req, res) => {
        try {
            // Redis list ki length fetch kar rahe hain
            const count = await redis.llen(EMAIL_QUEUE_KEY);
            res.status(200).json({count});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    // -------------------------------------------------------------------
    // @route   GET /email/queue/next
    // @desc    Queue se agla email nikaal ke (list se REMOVE karke) return
    //          karta hai — jaise ek worker email "process" kar raha ho.
    //          `rpop` list ke RIGHT end se nikalta hai, aur hum `lpush` se
    //          LEFT end par daalte hain — isliye ye FIFO order follow
    //          karta hai (sabse purana queued email sabse pehle milega).
    //
    //          NOTE: HTTP standard ke hisaab se GET request "safe" honi
    //          chahiye (matlab sirf read kare, state change na kare) —
    //          lekin ye route andar se data DELETE kar raha hai (`rpop`).
    //          Production me isko GET ke bajaye POST/DELETE rakhna better
    //          practice hai, warna koi automatic retry/prefetch silently
    //          emails queue se hata sakta hai.
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/email/queue/next', async(req, res) => {
        try {
            // Redis list se next email fetch kar rahe hain (FIFO)
            const nextEmail = await redis.rpop(EMAIL_QUEUE_KEY);
            if (!nextEmail) {
                return res.status(404).json({message: 'No emails in queue'});
            }
            res.status(200).json({email: JSON.parse(nextEmail)});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    return router;

}
