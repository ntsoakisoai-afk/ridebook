const jwt = require("jsonwebtoken");
const User = require('../models/User');

async function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            message: "Access denied. No token provided."
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            message: "Access denied. No token provided."
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch the user from database to ensure they exist
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
            return res.status(401).json({
                message: "User not found."
            });
        }

        // Attach user to request
        req.user = {
            id: user._id,
            role: user.role
        };

        next();

    } catch (err) {
        console.error('Auth error:', err.message);
        
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                message: "Invalid token."
            });
        }
        
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                message: "Token expired. Please login again."
            });
        }

        return res.status(500).json({
            message: "Authentication error.",
            error: err.message
        });
    }
}

module.exports = auth;