const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const { dbAsync } = require('./database');

// ==========================================
// 1. SERIALIZATION (Session persistence)
// ==========================================
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await dbAsync.get('SELECT * FROM users WHERE id = ?', [id]);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// ==========================================
// 2. LOCAL STRATEGY (Username/Password)
// ==========================================
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await dbAsync.get('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }

        // Handle legacy plain text passwords (optional migration step)
        // If password doesn't look like a bcrypt hash (starts with $2b$), compare directly? 
        // Better: Assume new registrations use bcrypt.
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            // Fallback for old plain text passwords (for demo mainly)
            if (user.password === password) return done(null, user);
            return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

// ==========================================
// 3. GOOGLE STRATEGY
// ==========================================
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/auth/google/callback'
    },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Check if user exists by Google ID
                let user = await dbAsync.get('SELECT * FROM users WHERE google_id = ?', [profile.id]);

                if (!user) {
                    // Check if user exists by Email (link accounts)
                    const email = profile.emails[0].value;
                    user = await dbAsync.get('SELECT * FROM users WHERE username = ?', [email]);

                    if (user) {
                        // Update existing user with Google ID
                        await dbAsync.run('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?',
                            [profile.id, profile.photos[0].value, user.id]);
                    } else {
                        // Create new user
                        await dbAsync.run(
                            'INSERT INTO users (username, password, google_id, avatar_url, subscription_status) VALUES (?, ?, ?, ?, ?)',
                            [email, 'GOOGLE_AUTH', profile.id, profile.photos[0].value, 'free']
                        );
                        user = await dbAsync.get('SELECT * FROM users WHERE google_id = ?', [profile.id]);
                    }
                } else {
                    // Update avatar just in case
                    await dbAsync.run('UPDATE users SET avatar_url = ? WHERE id = ?', [profile.photos[0].value, user.id]);
                    user.avatar_url = profile.photos[0].value; // Update local object
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }));
    console.log('🔑 Google OAuth initialized.');
} else {
    console.log('⚠️ Google OAuth skipped (Missing Env Vars).');
}

module.exports = passport;
