// =============================================================================
// json-hash.js -> Redis me object data store karne ke DO alag tareeke dikhata
// hai: "JSON string" vs "Hash". Ye ek important Redis concept hai jo har
// backend developer ko pata hona chahiye.
// =============================================================================
// APPROACH 1: JSON string (`/user/:id/json` routes)
//   Poora object JSON.stringify() karke ek single string value ki tarah SET
//   karte hain. READ karte waqt poora string wapas milta hai, JSON.parse()
//   karna padta hai — chahe humein object ka sirf ek field hi kyu na chahiye
//   ho, poori value fetch + parse karni padegi.
//
// APPROACH 2: Redis Hash (`/user/:id/hash` routes)
//   Redis ka apna native "Hash" data structure use karte hain — ek key ke
//   andar multiple field-value pairs directly store hote hain (jaise ek
//   mini object, bina JSON stringify/parse ke). Fayda ye hai ki:
//     - Ek single field ko seedha read/write kar sakte hain (HGET/HSET),
//       poore object ko touch kiye bina — bade objects ke liye bahut zyada
//       efficient hai (network + CPU dono me).
//     - Redis Hash ke andar values hamesha STRING ki tarah hi store hoti
//       hain — agar tumne number ya boolean bheja, wo bhi string ban jayega
//       jab wapas padhoge (isliye response me numbers bhi quotes ke saath
//       aa sakte hain, application layer par khud convert karna padta hai).
//
// Kab kya use karo: Agar poora object hamesha ek saath hi padhna/likhna hai
// -> JSON string simple hai. Agar object bada hai aur sirf kuch fields
// baar-baar individually access/update karni hain -> Hash zyada efficient
// hai.
// =============================================================================

import { Router } from "express";


export const jsonHashRouter = (redis) => {
    const router = Router();

    // -------------------------------------------------------------------
    // @route   POST /user/:id/json
    // @desc    Poore request body (object) ko JSON.stringify karke ek
    //          single string value ki tarah store karta hai.
    // -------------------------------------------------------------------
    router.post('/user/:id/json', async(req, res) => {
        try {
            const userId = req.params.id;
            const userData = req.body;

            // Redis me user data ko JSON.stringify karke store kar rahe hain
            await redis.set(`user:${userId}:json`, JSON.stringify(userData));
            res.status(200).json({message: 'User data stored successfully'});
        } catch (error) {
            res.status(500).json({error: error.message});
        }
    })

    // -------------------------------------------------------------------
    // @route   GET /user/:id/json
    // @desc    Poori JSON string ek saath fetch karke parse karta hai —
    //          chahe caller ko sirf ek field chahiye ho, poora object hi
    //          read hota hai.
    // -------------------------------------------------------------------
    router.get('/user/:id/json', async(req, res) => {
        try {
            const userId = req.params.id;
            const rawUserData = await redis.get(`user:${userId}:json`);

            if (!rawUserData) {
                return res.status(404).json({error: 'User not found'});
            }

            const userData = JSON.parse(rawUserData);
            res.status(200).json({user: userData});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    });

    // -------------------------------------------------------------------
    // @route   POST /user/:id/hash
    // @desc    Object ko Redis Hash ke roop me store karta hai.
    //          ioredis ka hset() ek object le kar uske saare key-value
    //          pairs ko us hash ke fields bana deta hai (jaise
    //          { name: "Rahul", age: 25 } se hash fields "name" aur
    //          "age" ban jate hain) — manually loop lagana nahi padta.
    // -------------------------------------------------------------------
    router.post('/user/:id/hash', async(req, res) => {
        try {
            const userId = req.params.id;
            const userData = req.body;

            // Redis me user data ko hash ke roop me store kar rahe hain
            await redis.hset(`user:${userId}:hash`, userData);
            res.status(200).json({message: 'User data stored successfully'});
        } catch (error) {
            res.status(500).json({error: error.message});
        }
    });

    // -------------------------------------------------------------------
    // @route   GET /user/:id/hash
    // @desc    Hash ke saare fields ek saath fetch karta hai.
    //          hgetall() key na milne par null NAHI, balki EMPTY OBJECT
    //          ({}) return karta hai — isliye "not found" check yahan
    //          "!rawUserData" se nahi, "Object.keys(...).length === 0"
    //          se karna padta hai (JSON route se ye ek important difference
    //          hai).
    // -------------------------------------------------------------------
    router.get('/user/:id/hash', async(req, res) => {
        try {
            const userId = req.params.id;
            const userData = await redis.hgetall(`user:${userId}:hash`);

            if (Object.keys(userData).length === 0) {
                return res.status(404).json({error: 'User not found'});
            }

            res.status(200).json({user: userData});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    // -------------------------------------------------------------------
    // @route   GET /user/:id/hash/field/:field
    // @desc    Hash ka SIRF EK field padhta hai (poora object fetch kiye
    //          bina) — yahi Hash approach ka sabse bada fayda hai JSON
    //          approach ke muqable. hget() field na milne par "null"
    //          return karta hai (Hash yahan "GET" jaisa hi behave karta
    //          hai, "HGETALL" jaisa nahi).
    // -------------------------------------------------------------------
    router.get('/user/:id/hash/field/:field', async(req, res) => {
        try {
            const userId = req.params.id;
            const field = req.params.field;
            const fieldValue = await redis.hget(`user:${userId}:hash`, field);

            if (fieldValue === null) {
                return res.status(404).json({error: 'Field not found'});
            }

            res.status(200).json({field: field, value: fieldValue});
        } catch(error) {
            res.status(500).json({error: error.message});
        }
    })

    return router;
}
