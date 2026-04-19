export interface LessonFrontmatter {
	title: string;
	module: number;
	lesson: number;
	moduleSlug: string;
	lessonSlug: string;
	description: string;
	duration: number;
	preview: boolean;
}

export interface LessonContent {
	meta: LessonFrontmatter;
	content: string;
}

export interface LessonMeta {
	slug: string;
	title: string;
	duration: number;
	preview: boolean;
}

export interface ModuleMeta {
	slug: string;
	title: string;
	moduleNumber: number;
	lessons: LessonMeta[];
}

export interface LessonNavLinks {
	prev: { moduleSlug: string; lessonSlug: string; title: string } | null;
	next: { moduleSlug: string; lessonSlug: string; title: string } | null;
}
