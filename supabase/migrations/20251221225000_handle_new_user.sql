-- 创建处理新用户的函数
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  new_profile_id uuid;
  user_username text;
  user_avatar text;
begin
  -- 从元数据获取用户名和头像，或者使用默认值
  user_username := new.raw_user_meta_data->>'username';
  if user_username is null or user_username = '' then
    user_username := 'User_' || substr(new.id::text, 1, 8);
  end if;
  
  user_avatar := new.raw_user_meta_data->>'avatar_url';

  -- 插入到 profiles 表
  insert into public.profiles (uid, username, avatar)
  values (new.id, user_username, user_avatar)
  returning id into new_profile_id;

  -- 插入到 settings 表
  insert into public.settings (owner_id)
  values (new_profile_id);

  return new;
end;
$$;

-- 创建触发器
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
