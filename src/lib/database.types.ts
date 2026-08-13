export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      book_reviewers: {
        Row: {
          book_id: string
          granted_at: string
          reviewer_id: string
          revoked_at: string | null
        }
        Insert: {
          book_id: string
          granted_at?: string
          reviewer_id: string
          revoked_at?: string | null
        }
        Update: {
          book_id?: string
          granted_at?: string
          reviewer_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "book_reviewers_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          author_id: string
          created_at: string
          id: string
          latest_version_number: number
          name: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          latest_version_number?: number
          name: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          latest_version_number?: number
          name?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_id: string
          body: string
          book_id: string
          created_at: string
          id: string
          thread_id: string
          version_number: number
        }
        Insert: {
          author_id: string
          body: string
          book_id: string
          created_at?: string
          id?: string
          thread_id: string
          version_number: number
        }
        Update: {
          author_id?: string
          body?: string
          book_id?: string
          created_at?: string
          id?: string
          thread_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "comments_thread_id_book_id_fkey"
            columns: ["thread_id", "book_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id", "book_id"]
          },
          {
            foreignKeyName: "comments_book_id_version_number_fkey"
            columns: ["book_id", "version_number"]
            isOneToOne: false
            referencedRelation: "versions"
            referencedColumns: ["book_id", "version_number"]
          },
        ]
      }
      threads: {
        Row: {
          book_id: string
          created_at: string
          created_by: string
          created_version_number: number
          id: string
          paragraph_text: string
          selected_text: string
        }
        Insert: {
          book_id: string
          created_at?: string
          created_by: string
          created_version_number: number
          id?: string
          paragraph_text: string
          selected_text: string
        }
        Update: {
          book_id?: string
          created_at?: string
          created_by?: string
          created_version_number?: number
          id?: string
          paragraph_text?: string
          selected_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_book_id_created_version_number_fkey"
            columns: ["book_id", "created_version_number"]
            isOneToOne: false
            referencedRelation: "versions"
            referencedColumns: ["book_id", "version_number"]
          },
        ]
      }
      thread_versions: {
        Row: {
          book_id: string
          status: string
          text_position: string | null
          thread_id: string
          thread_position: number | null
          version_number: number
        }
        Insert: {
          book_id: string
          status: string
          text_position?: string | null
          thread_id: string
          thread_position?: number | null
          version_number: number
        }
        Update: {
          book_id?: string
          status?: string
          text_position?: string | null
          thread_id?: string
          thread_position?: number | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "thread_versions_thread_id_book_id_fkey"
            columns: ["thread_id", "book_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id", "book_id"]
          },
          {
            foreignKeyName: "thread_versions_book_id_version_number_fkey"
            columns: ["book_id", "version_number"]
            isOneToOne: false
            referencedRelation: "versions"
            referencedColumns: ["book_id", "version_number"]
          },
        ]
      }
      users: {
        Row: {
          email: string
          id: string
        }
        Insert: {
          email: string
          id: string
        }
        Update: {
          email?: string
          id?: string
        }
        Relationships: []
      }
      versions: {
        Row: {
          book_id: string
          created_at: string
          hash: string
          id: string
          version_number: number
        }
        Insert: {
          book_id: string
          created_at?: string
          hash: string
          id?: string
          version_number: number
        }
        Update: {
          book_id?: string
          created_at?: string
          hash?: string
          id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "versions_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_book: { Args: { book: string }; Returns: boolean }
      grant_access: {
        Args: { book: string; email: string }
        Returns: undefined
      }
      start_thread: {
        Args: {
          book: string
          body: string
          paragraph_text: string
          range_end: number
          range_start: number
          selected_text: string
        }
        Returns: string
      }
      version_threads: {
        Args: { book: string; version_number: number }
        Returns: {
          comments: Json
          created_at: string
          created_by: string
          text_position: string
          thread_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

