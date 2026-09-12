# Chai aur Redis - 02 Setup

Ye ek learning project hai jisme hum seekh rahe hain ki **Redis** aur
**MongoDB** ko Docker ke through kaise setup karte hain, aur unhe ek simple
**Express (Node.js)** app se kaise connect karte hain.

## Project Structure

```
02-setup/
├── docker-compose.yml   # Redis + MongoDB containers ki configuration
├── package.json         # Node dependencies aur scripts
├── readme.md            # Ye file
└── setup/
    ├── index.js         # Express server ka entry point
    ├── site-banner.js   # "/banner" routes ka logic (Express Router)
    └── otp.js           # "/otp" routes ka logic (Express Router)
```

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — running
  hona chahiye (menu bar me whale icon)

## Setup - Step by Step

### 1. Dependencies install karo

Root folder (`02-setup`) me:

```bash
npm install
```

### 2. Docker containers (Redis + MongoDB) start karo

Docker Desktop app open/running hona chahiye, uske baad:

```bash
docker compose up -d
```

- `-d` (detached) mode me containers background me chalte hain.
- Isse do containers start honge:
  - `chai-and-redis` -> Redis, port `6379` par
  - `chai-and-mongo` -> MongoDB, port `27017` par
- Dono containers Docker Desktop me ek group ke andar dikhenge, jiska naam
  hai `chai-aur-redis-setup` (ye `docker-compose.yml` ke top-level `name:`
  se aata hai).

Containers ka status check karne ke liye:

```bash
docker compose ps
```

Containers band karne ke liye (jab kaam ho jaye):

```bash
docker compose down
```

### 3. Node server start karo

```bash
npm run dev
```

Isse `nodemon` ke through server start hota hai, jo `http://localhost:8000`
par sunna shuru kar deta hai. `nodemon` file me kuch bhi change hone par
server ko khud restart kar deta hai (development ke liye kaam aata hai).

## Available API Routes

> Code me (`index.js` aur `site-banner.js`) har route ke upar ek standard
> JSDoc-style comment hai, is format me:
> ```js
> // @route   GET /banner
> // @desc    Current banner fetch karo
> // @access  Public
> ```
> Isse code khud padhte waqt hi pata chal jata hai ki wo route kaunsa method
> + path handle karta hai aur uska kaam kya hai — bina neeche implementation
> padhe.

| Method | Route            | Kaam kya karta hai |
|--------|------------------|---------------------|
| GET    | `/redis`         | Redis ko `PING` karta hai, connection check karne ke liye. Reply me `PONG` aana chahiye. |
| GET    | `/mongo`         | MongoDB se connect karta hai (agar pehle se connected nahi hai), aur connected database ka naam return karta hai. |
| GET    | `/banner`        | Redis me `site:banner` key ke andar stored banner data return karta hai. Agar set nahi hai, `404` return hota hai. |
| POST   | `/banner`        | Naya banner set/update karta hai. Body me `{ "message": "...", "color": "..." }` chahiye. |
| DELETE | `/banner`        | Banner ko Redis se delete kar deta hai. |
| GET    | `/banner/exists` | Sirf ye batata hai ki banner set hai ya nahi (`{ "exists": true/false }`), actual data fetch kiye bina. |
| POST   | `/otp`           | Diye gaye phone number ke liye naya OTP generate karta hai aur Redis me `60 second` ki expiry ke saath store karta hai. Body: `{ "phone": "..." }`. |
| POST   | `/otp/verify`    | User ka diya hua OTP, Redis me stored value se match karke verify karta hai. Sahi hone par OTP turant delete ho jata hai (ek baar hi use ho sakta hai). Body: `{ "phone": "...", "otp": "..." }`. |
| GET    | `/otp/:phone/ttl`| Diye gaye phone number ke current OTP ka TTL (baaki bacha hua time, seconds me) batata hai. |

### Banner test karne ke liye (example commands)

```bash
# Banner set karo
curl -X POST http://localhost:8000/banner \
  -H "Content-Type: application/json" \
  -d '{"message":"Sale live!","color":"red"}'

# Banner check karo
curl http://localhost:8000/banner

# Banner exist karta hai ya nahi, check karo
curl http://localhost:8000/banner/exists

# Banner delete karo
curl -X DELETE http://localhost:8000/banner
```

### OTP test karne ke liye (example commands)

```bash
# OTP generate/send karo (server console me OTP print hoga, demo ke liye)
curl -X POST http://localhost:8000/otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210"}'

# OTP verify karo (console me print hui value yahan daalo)
curl -X POST http://localhost:8000/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","otp":"123456"}'

# OTP ka baaki bacha hua time (seconds) check karo
curl http://localhost:8000/otp/9876543210/ttl
```

> Note: Abhi real SMS gateway (Twilio/MSG91 jaisa) integrate nahi kiya hai —
> OTP sirf server ke console log me print hota hai, taaki learning/testing
> aasan rahe.

## Environment Variables (optional)

Agar chaho to default local URLs override kar sakte ho:

| Variable      | Default (agar set na ho)                          | Kaam |
|---------------|-----------------------------------------------------|------|
| `PORT`        | `8000`                                               | Express server kis port par chalega |
| `REDIS_URL`   | `redis://localhost:6379`                             | Redis connection URL |
| `MONGO_URL`   | `mongodb://localhost:27017/chai_aur_redis`          | MongoDB connection URL |

## Notes / Gotchas

- Agar `docker compose up` "cannot connect to docker daemon" jaisi error de,
  to Docker Desktop chal hi nahi raha — pehle usse open/start karo.
- Redis me data persist rehta hai kyunki `--appendonly yes` flag ke saath
  AOF persistence enable hai, aur data ek named volume (`redis-data`) me
  save hota hai. Isi tarah MongoDB ka data `mongo-data` volume me persist
  hota hai. Matlab container restart/remove karne par bhi data khota nahi
  (jab tak volume delete na karo).

---

## Maine (learning journey) kya kya steps follow kiye — Log

Ye section un actual steps/mistakes ka record hai jo is project ko banate
waqt follow/fix kiye gaye, taaki baad me revise karte waqt yaad rahe.

1. **Docker Compose file banayi** — `redis` aur `mongo` do services define
   ki, dono ke fixed `container_name`, `ports`, aur data persist karne ke
   liye named `volumes` (`redis-data`, `mongo-data`) add kiye.

2. **`docker compose up` chalane par error aayi** — turns out Docker Desktop
   app hi running nahi tha (`unix:///.../docker.sock` connect nahi ho pa
   raha tha). Fix: Docker Desktop ko `open -a Docker` se start kiya.

3. **Docker Desktop me containers ko group karke naam dena tha** — top-level
   `name:` key (`docker-compose.yml` me) add ki, taaki Docker Desktop me
   saare containers ek naamed group ke andar dikhein, individual folder-name
   ke bajaye.

4. **`npm run dev` chalane par app crash ho rahi thi** — do galtiyan mili:
   - `Process.env.REDIS_URL` likha tha (capital `P`), jबकि Node ka global
     object hamesha lowercase `process` hota hai — isse
     `ReferenceError: Process is not defined` aa raha tha.
   - `package.json` ka `dev` script root se `index.js` dhoond raha tha,
     jबकि actual file `setup/index.js` me thi. Script ko
     `"nodemon setup/index.js"` kiya.

5. **`/mongo` route par error aa rahi thi** — `mongoose.connect()` ko
   `useNewUrlParser` aur `useUnifiedTopology` options di gayi thi, jo
   Mongoose ke naye version (v9) me support hi nahi karte (deprecated ho
   chuke hain, ab default behavior hi wahi hai). Fix: dono options hata di.

6. **Banner feature add ki** — pehle sab kuch `index.js` me hi likha tha,
   jisme ek bug bhi tha: `const BANNER_KEY = BANNER_KEY;` (khud ko hi
   reference kar raha tha, isse crash hota).

7. **Banner ka code alag file me move kiya (`setup/site-banner.js`)** —
   Express ka **Router** pattern use karke: ek factory function
   (`siteBannerRouter(redis)`) banayi jo Redis client accept karti hai aur
   ek configured `Router` return karti hai. Isse:
   - `index.js` chhota/clean rehta hai.
   - Redis ka ek hi shared connection reuse hota hai (naya connection nahi
     banta har route file me).
   - `BANNER_KEY` bug bhi fix ho gaya — ab ek proper string
     (`'site:banner'`) hai.

8. **Banner ke aur routes add kiye** — sirf `GET /banner` tha, usme add
   kiya:
   - `POST /banner` — naya banner set/update karne ke liye (validation ke
     saath: `message` aur `color` dono required hain).
   - `DELETE /banner` — banner hatane ke liye.
   - `GET /banner/exists` — sirf existence check karne ke liye (halka/fast
     check, bina data fetch/parse kiye).

9. **Poori codebase me detailed comments (Hinglish me) add kiye** —
   `docker-compose.yml`, `index.js`, aur `site-banner.js` — taaki har line
   /section ka use-case aur "kyu likha gaya" clear rahe, kyunki Docker aur
   Redis dono naye topics hain.

10. **Har route ke upar standard `@route` / `@desc` / `@access` comments
    add kiye** (`index.js` aur `site-banner.js` dono me) — ek common Express
    convention, jisse har route ka method + path aur kaam ek nazar me pata
    chal jaye. `app.use(siteBannerRouter(redis))` ke upar bhi comment me
    likha ki is function se konse-konse route paths mount ho rahe hain
    (`GET /banner`, `POST /banner`, `DELETE /banner`, `GET /banner/exists`).

11. **OTP verification feature add ki (`setup/otp.js`)** — Banner jaisa hi
    Express Router pattern use karke, 3 naye routes banaye:
    - `POST /otp` — phone number ke liye ek random 6-digit OTP generate
      karta hai aur Redis me `SET key value EX 60` se **60 second ki
      expiry** ke saath store karta hai (Redis khud hi expire hote hi
      delete kar deta hai, manual cleanup ki zaroorat nahi).
    - `POST /otp/verify` — Redis se stored OTP nikaal ke user ke diye hue
      OTP se match karta hai. Match hone par OTP ko turant `redis.del()`
      se delete kar dete hain, taaki wahi OTP dobara (replay attack ki
      tarah) reuse na ho sake — ek OTP sirf ek hi baar valid hota hai.
    - `GET /otp/:phone/ttl` — `redis.ttl()` command se batata hai ki us
      phone ke OTP ka abhi kitna time bacha hai (seconds me); agar OTP
      exist hi nahi karta (kabhi bheja hi nahi gaya, ya expire ho chuka),
      to `404` return hota hai.
    - Poori file (`otp.js`) aur `index.js` me mounting wale hisse me
      detailed Hinglish comments add kiye — same standard jo banner file
      me use kiya tha (`@route` / `@desc` / `@body` / `@access`).
# redis-with-nodejs
