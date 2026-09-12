// =============================================================================
// index.js -> App ka entry point / main file
// =============================================================================
// Ye file Express server start karti hai aur Redis + MongoDB se connect karne
// ke liye kuch test/demo routes banati hai.
//
// RUN KAISE KAREIN:
//   Root folder (02-setup) se terminal me:
//       npm run dev
//   (ye "nodemon setup/index.js" chalata hai, jo file me changes hone par
//    server ko khud restart kar deta hai)
// =============================================================================

import express from 'express';
import Redis from 'ioredis';
import mongoose from 'mongoose';
import siteBannerRouter from './site-banner.js';

// Server kis port par chalega. Agar ".env" ya system me PORT set hai to wahi
// use hoga, warna default 8000.
const port = process.env.PORT || 8000;

// Express app banate hain -> ye hamara HTTP server hai jisme hum routes
// (jaise /redis, /mongo, /banner) define karte hain.
const app = express();

// Middleware: incoming request ka body agar JSON format me hai, to Express
// use apne aap parse karke "req.body" me object bana dega. Bina isके POST/PUT
// requests ka JSON body read nahi ho payega.
app.use(express.json());

// Redis client banate hain (ioredis library). Ye connection humare Docker
// compose se chal rahe Redis container se hoga.
// process.env.REDIS_URL -> agar environment variable set hai to wo URL use
// hoga (jaise production/deployment me), warna local Docker Redis
// (localhost:6379) se connect karenge.
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// ---------------------------------------------------------------------------
// @route   GET /redis
// @desc    Sirf ye check karne ke liye hai ki Redis se connection sahi hai
//          ya nahi. Redis ka "PING" command bheja jata hai, jiska reply
//          "PONG" aata hai agar connection healthy hai.
// @access  Public
// ---------------------------------------------------------------------------
app.get('/redis', async (req, res) => {
    try {
        const reply = await redis.ping();
        res.json({redis : reply});
    } catch (error) {
        // Agar Redis down hai ya connect nahi ho pa raha, to error yahan catch
        // hoke client ko 500 status ke saath bhej dete hain.
        res.status(500).json({error: error.message});
    }
})

// ---------------------------------------------------------------------------
// @route   GET /mongo
// @desc    MongoDB se connection banane/check karne ke liye hai.
// @access  Public
// ---------------------------------------------------------------------------
app.get('/mongo', async (req, res) => {
    try{
        // MONGO_URL env variable se ya default local Docker MongoDB se connect
        // karenge. URL ke aakhir me "/chai_aur_redis" hamara database naam hai.
        const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/chai_aur_redis';

        // mongoose.connection.readyState -> Mongoose batata hai connection ki
        // current state kya hai:
        //   0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
        // Hum sirf tabhi naya connect() call karte hain jab abhi connected na
        // ho, taaki baar baar unnecessary reconnect na ho.
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(mongoUrl);
            res.json({mongo : 'Connected to MongoDB', database: mongoose.connection.name});
        } else {
            res.json({mongo : 'Already connected to MongoDB', database: mongoose.connection.name});
        }
    }catch(error){
        res.status(500).json({error: error.message});
    }
})

// ---------------------------------------------------------------------------
// Site Banner API's
// Banner se related saare routes ek alag file "site-banner.js" me rakhe gaye
// hain (Express Router pattern) taaki ye file (index.js) chhoti aur saaf
// rahe, aur banner ka logic apni jagah organized rahe.
//
// siteBannerRouter(redis) -> Redis client isme pass kar rahe hain, taaki
// banner routes usi ek shared Redis connection ko use karein (naya/alag
// connection na banayein).
// app.use(...) -> Us router ke saare routes is app me "mount" ho jate hain,
// jaise wo yahin likhe gaye hon. Is function se ye routes mount hote hain:
//   GET    /banner         -> current banner fetch karo
//   POST   /banner         -> naya banner set/update karo
//   DELETE /banner         -> banner hata do
//   GET    /banner/exists  -> sirf check karo banner set hai ya nahi
// (In sab routes ka actual implementation "site-banner.js" me hai.)
// ---------------------------------------------------------------------------
app.use(siteBannerRouter(redis));

// Server ko actually start karte hain, given port par sunna (listen) shuru
// kar deta hai. Callback function tabhi chalta hai jab server successfully
// start ho jaye.
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
