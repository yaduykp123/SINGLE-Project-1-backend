import transporter from "../config/nodemailer.js";

export const sendOTP = async(email,otp)=>{

 await transporter.sendMail({
    from:process.env.EMAIL_USER,
    to:email,
    subject:"ExpireOFF Verification Code",
    html:`
      <h2>Verify Your Email</h2>
      <h1>${otp}</h1>
      <p>OTP expires in 10 minutes.</p>
    `
 });

};

// Send an order confirmation invoice to the buyer
export const sendOrderConfirmationEmail = async (email, details) => {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Order Confirmed: expireOFF Booking #${details.bookingId}`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #07110b; color: white; padding: 25px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #1a2e1f;">
          <h2 style="color: #22c55e; margin-bottom: 5px;">Order Confirmed!</h2>
          <p style="color: #a3a3a3; font-size: 14px;">Your booking has been successfully placed. Details are below:</p>
          
          <div style="background-color: rgba(255,255,255,0.03); border: 1px solid #1a2e1f; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong style="font-size: 18px; color: #ffffff;">${details.productName}</strong><br/>
            <span style="color: #a3a3a3; font-size: 14px;">Quantity Booked: ${details.quantity}</span><br/>
            <span style="color: #22c55e; font-size: 16px; font-weight: bold; display: block; margin-top: 10px;">Total Paid: ₹${details.totalPrice}</span>
          </div>

          <p>Hi ${details.buyerName}, thank you for supporting sustainable food sharing! Please coordinate pickup details with the listing seller.</p>
          
          <hr style="border: 0; border-top: 1px solid #1a2e1f; margin: 20px 0;"/>
          <p style="font-size: 11px; color: #6b7280; text-align: center;">expireOFF - Saving Savings & Smiles</p>
        </div>
      `
    });
  } catch (error) {
    console.error("Nodemailer: Failed to send order confirmation email:", error.message);
  }
};