
const computeEMA = (data, period) => {
    const res = [];
    if (!data || !data.length || period <= 0) return res;
    const k = 2 / (period + 1);
    let ema;
    // Initialize with SMA
    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) { sum += data[i].close; }
    if (data.length < period) return res;
    ema = sum / period;
    res.push({ time: data[period - 1].time, value: ema });
    // Calculate EMA
    for (let i = period; i < data.length; i++) {
        const close = data[i].close;
        ema = (close - ema) * k + ema;
        res.push({ time: data[i].time, value: ema });
    }
    return res;
};

// Test Data: [10, 11, 12, 13, 14], Period: 3
// k = 2 / 4 = 0.5
// SMA(3) = (10+11+12)/3 = 11
// EMA_4 = (13 - 11)*0.5 + 11 = 12
// EMA_5 = (14 - 12)*0.5 + 12 = 13

const data = [
    { time: 1, close: 10 },
    { time: 2, close: 11 },
    { time: 3, close: 12 },
    { time: 4, close: 13 },
    { time: 5, close: 14 },
];

const result = computeEMA(data, 3);
console.log("Input:", JSON.stringify(data.map(d => d.close)));
console.log("Calculated EMA:", JSON.stringify(result, null, 2));

const expected = [
    { time: 3, value: 11 },
    { time: 4, value: 12 },
    { time: 5, value: 13 }
];

// Check equality
const isCorrect = JSON.stringify(result) === JSON.stringify(expected);
console.log("Verification Passed:", isCorrect);
if (!isCorrect) {
    console.error("Expected:", JSON.stringify(expected, null, 2));
    process.exit(1);
}
