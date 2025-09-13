const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

router.post('/', whatsappController.handleWebhook);
router.get('/', whatsappController.verifyWebhook);

module.exports = router;