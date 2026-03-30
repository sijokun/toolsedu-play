import { createRouter, createWebHistory } from 'vue-router'
import Host from './components/Host.vue'
import Player from './components/Player.vue'
import HomeMenu from './components/HomeMenu.vue'

const routes = [
  { path: '/', component: Player },
  { path: '/menu', component: HomeMenu },
  { path: '/host', component: Host },
  { path: '/host/:gameCode/:uid', component: Host },
  { path: '/player', component: Player },
  { path: '/player/:gameCode', component: Player },
  { path: '/:gameCode', component: Player },
  { path: '/player/:gameCode/:uid', component: Player },
]

export default createRouter({ history: createWebHistory(), routes })
