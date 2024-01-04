const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;
const secret = process.env.ACCESS_TOKEN_SECRET;

//parsers
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.88ffpvi.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const userCollection = client.db("bistroDB").collection("users");
const menuCollection = client.db("bistroDB").collection("menu");
const reviewCollection = client.db("bistroDB").collection("reviews");
const cartCollection = client.db("bistroDB").collection("carts");
const paymentCollection = client.db("bistroDB").collection("payments");

async function run() {
  try {
    // JWT relate api
    app.post("/api/v1/jwt/access-token", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, secret, { expiresIn: "24h" });
      res.send({ token });
    });

    // Middleware
    const verifyToken = (req, res, next) => {
      // console.log("inside verify token ", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, secret, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Admin api
    app.get("/api/v1/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded?.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    // user related api
    app.get("/api/v1/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/v1/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Make user as an Admin
    app.patch(
      "/api/v1/admin/makeAdmin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // Delete User
    app.delete(
      "/api/v1/admin/deleteUsers/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);
        res.send(result);
      }
    );

    // Menu related API
    app.get("/api/v1/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post(
      "/api/v1/admin/menu",
      verifyAdmin,
      verifyAdmin,
      async (req, res) => {
        const menuItem = req.body;
        const result = await menuCollection.insertOne(menuItem);
        res.send(result);
      }
    );

    app.patch(
      "/api/v1/admin/menu/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const item = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            ...item,
          },
        };
        const result = await menuCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.delete(
      "/api/v1/admin/deleteItem/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await menuCollection.deleteOne(query);
        res.send(result);
      }
    );

    app.get("/api/v1/admin/menu/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    // Reviews related api
    app.get("/api/v1/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Cart Collection
    app.get("/api/v1/user/carts", async (req, res) => {
      const queryEmail = req.query.email;
      const query = { email: queryEmail };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/api/v1/user/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/api/v1/user/carts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Payment Intent
    app.post("/api/v1/user/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = parseInt(price * 100);

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          // integrate payment_method_types form PaymentIntent API docs
          payment_method_types: ["card", "link"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        console.log(error);
      }
    });

    // Payment related api
    app.get("/api/v1/user/payment/:email", verifyToken, async (req, res) => {
      const queryEmail = req.params.email;
      const decodedEmail = req.decoded?.email;

      if (queryEmail !== decodedEmail) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const query = { email: queryEmail };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/api/v1/user/payment", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const paymentResult = await paymentCollection.insertOne(paymentInfo);

        // Delete each item from the cart
        const query = {
          _id: {
            $in: paymentInfo?.cartIds?.map((id) => new ObjectId(id)),
          },
        };

        const deleteResult = await cartCollection.deleteMany(query);

        res.send({ paymentResult, deleteResult });
      } catch (err) {
        console.log("Payment error", err);
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro boss in running");
});

app.listen(port, () => {
  console.log(`Bistro Boss app listening on port ${port}`);
});
