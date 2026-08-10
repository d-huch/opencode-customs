import { createOrder, orderTotal } from "./order-service.mjs"

export function postOrder(request) {
  createOrder(request.body)
  return { status: 201, total: orderTotal(request.body.id) }
}
