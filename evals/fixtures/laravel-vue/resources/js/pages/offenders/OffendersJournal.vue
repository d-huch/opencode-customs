<script setup>
import { onMounted, ref } from "vue"

const rows = ref([])

onMounted(async () => {
  rows.value = await fetch("/journals/offenders").then((response) => response.json())
})
</script>

<template>
  <table>
    <tr v-for="row in rows" :key="row.soldier">
      <td>{{ row.soldier }}</td>
      <td>{{ row.status }}</td>
    </tr>
  </table>
</template>
