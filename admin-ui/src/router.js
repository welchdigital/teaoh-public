import { createRouter, createWebHashHistory } from 'vue-router';
import { titleFor } from './composables/usePageTitle.js';
import Dashboard from './views/Dashboard.vue';
import Server from './views/Server.vue';
import Players from './views/Players.vue';
import Characters from './views/Characters.vue';
import CharacterDetail from './views/CharacterDetail.vue';
import Accounts from './views/Accounts.vue';
import AccountDetail from './views/AccountDetail.vue';
import Bans from './views/Bans.vue';
import Mutes from './views/Mutes.vue';
import Reports from './views/Reports.vue';
import Guilds from './views/Guilds.vue';
import GuildDetail from './views/GuildDetail.vue';
import MapViewer from './views/MapViewer.vue';
import Logs from './views/Logs.vue';
import Chat from './views/Chat.vue';
import Audit from './views/Audit.vue';
import Settings from './views/Settings.vue';
import NotFound from './views/NotFound.vue';

const routes = [
  { path: '/', name: 'dashboard', component: Dashboard, meta: { title: 'Dashboard', section: 'dashboard' } },
  { path: '/server', name: 'server', component: Server, meta: { title: 'Server', section: 'server' } },
  { path: '/players', name: 'players', component: Players, meta: { title: 'Online players', section: 'players' } },
  {
    path: '/players/:id(\\d+)',
    redirect: (to) => ({ name: 'character', params: { id: to.params.id } }),
  },
  { path: '/characters', name: 'characters', component: Characters, meta: { title: 'Characters', section: 'characters' } },
  {
    path: '/characters/:id(\\d+)',
    name: 'character',
    component: CharacterDetail,
    meta: { title: 'Character', section: 'characters' },
  },
  { path: '/accounts', name: 'accounts', component: Accounts, meta: { title: 'Accounts', section: 'accounts' } },
  {
    path: '/accounts/:id(\\d+)',
    name: 'account',
    component: AccountDetail,
    meta: { title: 'Account', section: 'accounts' },
  },
  { path: '/bans', name: 'bans', component: Bans, meta: { title: 'Bans', section: 'bans' } },
  { path: '/mutes', name: 'mutes', component: Mutes, meta: { title: 'Mutes', section: 'mutes' } },
  { path: '/reports', name: 'reports', component: Reports, meta: { title: 'Reports', section: 'reports' } },
  { path: '/guilds', name: 'guilds', component: Guilds, meta: { title: 'Guilds', section: 'guilds' } },
  { path: '/guilds/:tag', name: 'guild', component: GuildDetail, meta: { title: 'Guild', section: 'guilds' } },
  { path: '/maps', name: 'maps', component: MapViewer, meta: { title: 'Map viewer', section: 'maps' } },
  { path: '/logs', name: 'logs', component: Logs, meta: { title: 'Logs', section: 'logs' } },
  { path: '/chat', name: 'chat', component: Chat, meta: { title: 'Chat', section: 'chat' } },
  { path: '/audit', name: 'audit', component: Audit, meta: { title: 'Audit log', section: 'audit' } },
  { path: '/settings', name: 'settings', component: Settings, meta: { title: 'Settings', section: 'settings' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound, meta: { title: 'Not found' } },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
    return false;
  },
});

router.afterEach((to) => {
  document.title = titleFor(to);
});
