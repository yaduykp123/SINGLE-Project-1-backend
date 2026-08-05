import products from "razorpay/dist/types/products";


export const getNearByProducts = async (req, res) => {


    const {longi, lati, maxDistence= 10000, category} = req.query;

    try {
        // Q1 
    const nearByProducts = await Product.find({
        location : {
            $near : {
                $geometry: {type: "Point", coordinates :[parseFloat(longi),parseFloat(lati)],
                },
                $maxDistance : parseInt(maxDistence)
            }
        }
    }) 
    res.status(200).json({ result: nearByProducts.length})

    } catch (error) {
        res.status(500).json({error:error.message})
    }


// find all products
   const AllProducts = await Product.find()

//    find all prodcuts whose category is "vegitables"
const vegitables = await Product.find({cetegory: "vegitables"})

//  find all products stock greter than (>) 20;
const gt20_StockProducts = await Product.find({
    stock: {$gt:20}
}) 
//find all  outofStock products
const outStock = await Product.find({
    stock: 0
})
//    find all verified users
const verifiedUsers = await Product.find({isVerified: true})

// find all blocked users
const BlockUsers = await Product.find({isBlocked: true}) 

// find all name with price of every products
const nameWITHprice = await Product.aggregate([{$project:{name:1,DiscountPrice:1,_id:0}}])

// sort products discout Price low to high
const discountProduts = await Product.aggregate([{$sort:{DiscountPrice:1}}])

// sort by newest product
const newProduct = await Product.find().sort({CreatedAt: -1})

// find the first 5 products
const fiveProdcuts_1st =  await Product.find().limit(5)

// find Product priced b/w 100 and 500
const PricedProduct = await Product.aggregate([{$match:{DiscountPrice:{$gte:100,$lte:500}}}])
}
