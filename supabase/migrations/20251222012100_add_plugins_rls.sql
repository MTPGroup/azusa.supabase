-- 插件策略
create policy "Plugins viewable if approved" on plugins
for select
to anon
using (status = 'approved');

create policy "Authenticated users can view own plugins" on plugins
for select
to authenticated
using (author_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can insert own plugins" on plugins
for insert
with check (author_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can update own plugins" on plugins
for update
using (author_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can delete own plugins" on plugins
for delete
using (author_id = (select id from profiles where uid = (select auth.uid())));

-- 插件订阅策略
create policy "Authenticated users can view their plugin subscriptions" on plugin_subscriptions
for select
to authenticated
using (user_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can subscribe to plugins" on plugin_subscriptions
for insert
to authenticated
with check (user_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can update their subscriptions" on plugin_subscriptions
for update
to authenticated
using (user_id = (select id from profiles where uid = (select auth.uid())));

create policy "Authenticated users can cancel their subscriptions" on plugin_subscriptions
for delete
to authenticated
using (user_id = (select id from profiles where uid = (select auth.uid())));
