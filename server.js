const express = require('express');
const cors = require('cors');
const { dbAsync } = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

// API Endpoint for price history for a specific listing
app.get('/api/listings/:id/history', async (req, res) => {
    try {
        const history = await dbAsync.all(
            'SELECT price, checked_at as date FROM price_history WHERE listing_id = ? ORDER BY checked_at ASC',
            [req.params.id]
        );

        if (!history || history.length === 0) {
            return res.status(404).json({ message: 'History not found' });
        }

        res.json(history);
    } catch (err) {
        console.error('❌ API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Serve the dashboard at the root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 AutoRadar Server running at http://localhost:${PORT}`);
    console.log(`📊 Price History API: http://localhost:${PORT}/api/listings/:id/history`);
});
