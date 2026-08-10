const rows = new Map()

export function save(order) {
  rows.set(order.id, order)
  return order
}

export function find(id) {
  return rows.get(id)
}
