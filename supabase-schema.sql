-- NickelTrack Supabase Schema
-- Run this entire file in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

-- 1. User Preferences
create table if not exists user_preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  daily_goal_ug integer not null default 150,
  serving_units text not null default 'us' check (serving_units in ('us', 'metric')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;
create policy "Users can view own preferences" on user_preferences for select using (auth.uid() = user_id);
create policy "Users can insert own preferences" on user_preferences for insert with check (auth.uid() = user_id);
create policy "Users can update own preferences" on user_preferences for update using (auth.uid() = user_id);

-- 2. Meal Entries
create table if not exists meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  entry_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snacks')),
  food_id text,
  name_en text not null,
  nickel_ug_per_serving real not null default 0,
  servings real not null default 1,
  nickel_band text,
  serving_size_g real,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table meal_entries enable row level security;
create policy "Users can view own meal entries" on meal_entries for select using (auth.uid() = user_id);
create policy "Users can insert own meal entries" on meal_entries for insert with check (auth.uid() = user_id);
create policy "Users can update own meal entries" on meal_entries for update using (auth.uid() = user_id);
create policy "Users can delete own meal entries" on meal_entries for delete using (auth.uid() = user_id);

create index idx_meal_entries_user_date on meal_entries(user_id, entry_date);

-- 3. Recipes
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  local_id text not null,
  name text not null,
  total_servings integer not null default 1,
  created_at timestamptz not null default now()
);

alter table recipes enable row level security;
create policy "Users can view own recipes" on recipes for select using (auth.uid() = user_id);
create policy "Users can insert own recipes" on recipes for insert with check (auth.uid() = user_id);
create policy "Users can update own recipes" on recipes for update using (auth.uid() = user_id);
create policy "Users can delete own recipes" on recipes for delete using (auth.uid() = user_id);

create index idx_recipes_user on recipes(user_id);

-- 4. Recipe Ingredients
create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references recipes(id) on delete cascade not null,
  food_id text,
  name_en text not null,
  nickel_ug_per_serving real not null default 0,
  servings real not null default 1,
  nickel_band text,
  serving_size_g real,
  sort_order integer not null default 0
);

alter table recipe_ingredients enable row level security;
-- recipe_ingredients RLS via join to recipes table
create policy "Users can view own recipe ingredients" on recipe_ingredients for select
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()));
create policy "Users can insert own recipe ingredients" on recipe_ingredients for insert
  with check (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()));
create policy "Users can update own recipe ingredients" on recipe_ingredients for update
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()));
create policy "Users can delete own recipe ingredients" on recipe_ingredients for delete
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid()));

-- 5. Meal Plan Entries
create table if not exists meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  week_key text not null,
  entry_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snacks')),
  name_en text not null,
  nickel_ug_per_serving real not null default 0,
  servings real not null default 1,
  entry_type text not null default 'food' check (entry_type in ('food', 'recipe')),
  food_id text,
  recipe_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table meal_plan_entries enable row level security;
create policy "Users can view own plan entries" on meal_plan_entries for select using (auth.uid() = user_id);
create policy "Users can insert own plan entries" on meal_plan_entries for insert with check (auth.uid() = user_id);
create policy "Users can update own plan entries" on meal_plan_entries for update using (auth.uid() = user_id);
create policy "Users can delete own plan entries" on meal_plan_entries for delete using (auth.uid() = user_id);

create index idx_meal_plan_user_week on meal_plan_entries(user_id, week_key);
