import type { ItemWithListings } from "@jf/shared";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { ItemForm } from "../components/ItemForm";
import { useLoad } from "../hooks";
import { Loader } from "../components/Loader";

export function NewItem() {
  const navigate = useNavigate();
  return (
    <>
      <div className="page-head">
        <h1>Add item</h1>
      </div>
      <ItemForm
        submitLabel="Save item"
        onSubmit={async (input) => {
          const item = await api<ItemWithListings>("/api/items", { json: input });
          navigate(`/items/${item.id}`);
        }}
      />
    </>
  );
}

export function EditItem() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: item, error } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  if (error) return <p className="error">{error.message}</p>;
  if (!item) return <Loader label="Loading item…" />;
  return (
    <>
      <div className="page-head">
        <h1>Edit item</h1>
        <Link to={`/items/${id}`}>Cancel</Link>
      </div>
      <ItemForm
        initial={item}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await api(`/api/items/${id}`, { method: "PATCH", json: input });
          navigate(`/items/${id}`);
        }}
      />
    </>
  );
}
