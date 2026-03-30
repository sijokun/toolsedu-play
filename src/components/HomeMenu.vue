<script setup>
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="container">
    <h1>Quiz Game</h1>
    <p>Choose your role:</p>
    <div>
      <button @click="router.push('/host')">Create Game (Host)</button>
      <button @click="router.push('/player')">Join Game (Player)</button>
    </div>
  </div>
</template>
