const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

const sendPasswordResetEmail = async (to, name, resetUrl) => {
  await transporter.sendMail({
    from: `"Marvel RPG" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Marvel RPG — Reset your password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f1f5f9; padding: 32px; border-radius: 12px;">
        <h2 style="color: #ef4444; margin-top: 0;">Marvel RPG</h2>
        <p>Hi ${name},</p>
        <p>You requested to reset your password. Click the button below to choose a new one:</p>
        <a href="${resetUrl}" style="display: inline-block; margin: 16px 0; padding: 12px 28px; background: #ef4444; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          Reset Password
        </a>
        <p style="color: #94a3b8; font-size: 13px;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
        <p style="color: #94a3b8; font-size: 12px; word-break: break-all;">Or copy this link: ${resetUrl}</p>
      </div>
    `,
  })
}

module.exports = { sendPasswordResetEmail }
