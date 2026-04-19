-- Lesson progress — tracks which lessons each user has completed.
create table public.lesson_progress (
	id uuid default gen_random_uuid() primary key,
	user_id uuid references public.profiles(id) on delete cascade not null,
	module_slug text not null,
	lesson_slug text not null,
	completed boolean default false not null,
	completed_at timestamptz,
	created_at timestamptz default now() not null,
	unique (user_id, module_slug, lesson_slug)
);

alter table public.lesson_progress enable row level security;

create policy "Users can view own progress"
	on public.lesson_progress for select
	using (auth.uid() = user_id);

create policy "Users can insert own progress"
	on public.lesson_progress for insert
	with check (auth.uid() = user_id);

create policy "Users can update own progress"
	on public.lesson_progress for update
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

create index lesson_progress_user_module_idx
	on public.lesson_progress(user_id, module_slug);
