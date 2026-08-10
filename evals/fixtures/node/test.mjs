import assert from "node:assert/strict"
import { postOrder } from "./src/order-controller.mjs"

assert.deepEqual(postOrder({ body: { id: "one", total: "12.50" } }), {
  status: 201,
  total: "$12.50",
})
