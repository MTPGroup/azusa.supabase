-- Create plugin_likes table for tracking individual user likes
create table if not exists public.plugin_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  plugin_id uuid not null references public.plugins(id) on delete cascade,
  created_at timestamp with time zone default now() not null,
  primary key (user_id, plugin_id)
);

-- Enable RLS
alter table public.plugin_likes enable row level security;

-- RLS Policies
create policy "Users can view all plugin likes" on public.plugin_likes
  for select using (true);

create policy "Users can toggle their own plugin likes" on public.plugin_likes
  for insert with check (
    exists (
      select 1 from public.profiles
      where id = user_id and uid = auth.uid()
    )
  );

create policy "Users can remove their own plugin likes" on public.plugin_likes
  for delete using (
    exists (
      select 1 from public.profiles
      where id = user_id and uid = auth.uid()
    )
  );

-- Trigger to update liked counter in plugins table automatically
create or replace function public.update_plugin_like_count()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.plugins
    set liked = liked + 1
    where id = new.plugin_id;
  elsif (TG_OP = 'DELETE') then
    update public.plugins
    set liked = liked - 1
    where id = old.plugin_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

-- Attach trigger
drop trigger if exists on_plugin_like_change on public.plugin_likes;
create trigger on_plugin_like_change
after insert or delete on public.plugin_likes
for each row execute function public.update_plugin_like_count();
