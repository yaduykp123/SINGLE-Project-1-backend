import cron from "node-cron";
import Product from "../models/productSchema.js";
import transporter from "../config/nodemailer.js";


export const startExpiryCheckScheduler = () => {
  cron.schedule("0 9 * * *", async () => {
    console.log("CRON RUNNING: Checking database for user-posted products expiring soon...");
    
    try {
      
      // We want to find items expiring within the next 3 days.
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3); // 3 days in future
      threeDaysFromNow.setHours(23, 59, 59, 999); // End of that day

      // CHECK USER-POSTED PRODUCTS
      // Find active products (stock > 0) expiring within the next 3 days that haven't been emailed yet
      const expiringProducts = await Product.find({
        expiryDate: { $gte: today, $lte: threeDaysFromNow },
        stock: { $gt: 0 },
       isActive: true,
        expiryReminderSent: { $ne: true },
      }).populate("owner");

      console.log(`CRON: Found ${expiringProducts.length} expiring posted products that need seller alerts.`);

      for (const product of expiringProducts) {
        if (!product.owner || !product.owner.email) continue;

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: product.owner.email,
          subject: `ExpireOff Alert: Your posted product "${product.name}" is expiring soon! ⏰`,
          html: `
            <div style="font-family: Arial, sans-serif; background-color: #07110b; color: white; padding: 25px; border-radius: 12px; max-width: 500px; margin: 0 auto; border: 1px solid #1a2e1f;">
              <h2 style="color: #eab308; margin-bottom: 5px;">Seller Alert: Product Expiring Soon!</h2>
              <p style="color: #a3a3a3; font-size: 14px;">Your listed product is approaching its expiry date.</p>
              
              <div style="background-color: rgba(255,255,255,0.03); border: 1px solid #1a2e1f; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <strong style="font-size: 18px; color: #ffffff;">${product.name}</strong><br/>
                <span style="color: #a3a3a3; font-size: 14px;">Category: ${product.category}</span><br/>
                <span style="color: #a3a3a3; font-size: 14px;">Stock: ${product.stock} units remaining</span><br/>
                <span style="color: #fca5a5; font-size: 14px; font-weight: bold;">Expires: ${new Date(product.expiryDate).toLocaleDateString()}</span>
              </div>

              <p>Hi ${product.owner.fullName || "Seller"}, your product listing is expiring soon. You may want to lower the discount price further or share it with users nearby to avoid waste!</p>
              
              <hr style="border: 0; border-top: 1px solid #1a2e1f; margin: 20px 0;"/>
              <p style="font-size: 11px; color: #6b7280; text-align: center;">Sent automatically by ExpireOff</p>
            </div>
          `,
        };

        try {
          await transporter.sendMail(mailOptions);
          product.expiryReminderSent = true;
          await product.save();
          console.log(`CRON: Expiry alert email sent successfully to seller ${product.owner.email} for product "${product.name}".`);
        } catch (mailError) {
          console.error(`CRON ERROR: Failed to send email to seller ${product.owner.email} for product "${product.name}":`, mailError);
        }
      }

    } catch (error) {
      console.error("CRON ERROR: Failed to execute daily expiry checks:", error);
    }
  });
};
