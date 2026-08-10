import { find, save } from "./order-repository.mjs"

export function createOrder(input) {
  return save({ id: input.id, total: Number(input.total), status: "created" })
}

export function orderTotal(id) {
  return `$${find(id).total * 100}`
}
