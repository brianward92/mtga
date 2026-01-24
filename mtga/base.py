from abc import abstractmethod
import csv
from functools import lru_cache
import gzip
import os
import pickle
import re

import numpy as np
import pandas as pd
from scipy import sparse

from mtga.pub.replay_dtypes import get_dtypes

DATA_TYPES = [
    "draft",
    "game",
    "replay",
]

SETS = [
    "LTR",
]

LIMITED_TYPES = [
    "PremierDraft",
    "TradDraft",
    "Sealed",
    "TradSealed",
]


DEFAULT_DATA_DIR = "~/dat/17Lands"


@lru_cache()
def get_dtypes_cached(filename):
    res = get_dtypes(filename)
    if True:  # hack for now...
        res = {k: "str" for k in res}
        if "won" in res:
            res["won"] = "bool"
    return res


class MTGReader(object):
    def __init__(
        self,
        set_code,
        limited_type,
        data_type,
        dat_path,
        processed_sep="::",
    ):
        # Set Init Data
        self.set_code = set_code
        self.limited_type = limited_type
        self.data_type = data_type
        self.dat_path = os.path.expanduser(dat_path)
        self.processed_sep = processed_sep

        # Set Up Disk Locations for Processed Data
        self.setup_disk_meta()

        # Set Column Metadata
        self.set_header()

        # Other Generic Data
        self._n_lines = None

    def setup_disk_meta(self):

        # input file
        self.raw_file_path = ".".join(
            [f"{self.data_type}_public", self.set_code, self.limited_type, "csv.gz"]
        )
        self.raw_file_path = os.path.join(self.dat_path, "raw", self.raw_file_path)

        # cached usable format
        self.processed_dir = self.processed_sep.join(
            [
                f"data_type={self.data_type}",
                f"set_code={self.set_code}",
                f"limited_type={self.limited_type}",
            ]
        )
        self.processed_dir = os.path.join(
            self.dat_path, "processed", self.processed_dir
        )
        os.makedirs(self.processed_dir, exist_ok=True)

        return

    def set_header(self):
        with gzip.open(self.raw_file_path, "rt") as file:
            self.header = next(csv.reader(file))
            self.set_column_meta(self.header)
        assert len(set(self.header)) == len(self.header), "Duplicated columns!"
        return

    @abstractmethod
    def set_column_meta(self, header):
        raise NotImplementedError("Base class.")

    @property
    def n_lines(self):
        if self._n_lines is None:
            with gzip.open(self.raw_file_path, "rt") as file:
                self._n_lines = sum(1 for line in file) - 1
        return self._n_lines

    def read_iterator(self, chunk_size, dtypes=False):
        if dtypes:
            return pd.read_csv(
                self.raw_file_path,
                chunksize=chunk_size,
                dtype=get_dtypes_cached(self.raw_file_path),
            )
        else:
            return pd.read_csv(self.raw_file_path, chunksize=chunk_size)


## Game Data

CARD_POSITIONS = [
    "drawn",
    "deck",
    "opening_hand",
    "sideboard",
    "tutored",
]


class GameDataBaseReader(MTGReader):

    def __init__(
        self,
        set_code,
        limited_type,
        dat_path=DEFAULT_DATA_DIR,
        chunk_size=10000,
    ):
        super().__init__(set_code, limited_type, "game_data", dat_path)

        # game data split b/w card and non-card data
        self.cached_noncard_data = os.path.join(self.processed_dir, "noncard_data.csv")
        self.cached_card_data = os.path.join(self.processed_dir, "card_data.pkl")

        # cache read
        self.noncard_data = None
        self.card_data = None
        self.is_loaded = False

        self.chunk_size = chunk_size

        return

    def set_column_meta(self, header):

        # initialize meta
        self.card_meta = dict()  # positions -> cards
        self.noncard_columns = []  # fields not related to card position
        self.card_positions = []  # list of card positions
        self.card_names = []  # list of card names

        # loop over columns
        for column in header:
            is_card = False
            for card_position in CARD_POSITIONS:
                prefix = f"{card_position}_"
                if column.startswith(prefix):
                    is_card = True
                    break  # `card_position, prefix` needed later
            if is_card:
                card_name = column.replace(prefix, "")
                self.card_meta[card_position] = self.card_meta.get(
                    card_position, []
                ) + [card_name]
                self.card_positions.append(card_position)
                self.card_names.append(card_name)
            else:
                self.noncard_columns.append(column)

        # check column uniqueness
        card_positions = sorted(set(self.card_positions))
        card_names = set(self.card_names)
        for card_position in card_positions:
            s = set(self.card_meta[card_position])
            assert card_names == s
        return

    def cards_to_cards_sparse(self, cards):
        data = cards.values
        is_non_zero = data != 0
        data = data[is_non_zero]  # "auto-raveled"
        indptr, indices = np.where(is_non_zero)
        _, indptr = np.unique(indptr, return_counts=True)
        indptr = np.insert(indptr.cumsum(), 0, 0)
        return data, indices, indptr, cards.shape

    def get_data(self, force_refresh=False):
        if force_refresh:
            self.noncard_data = []
            self.card_data = []
            n_chunks = self.n_lines // self.chunk_size + 1
            for i, chunk in enumerate(self.read_iterator(self.chunk_size)):
                self.noncard_data.append(chunk[self.noncard_columns])
                chunk = chunk.drop(self.noncard_columns, axis=1)
                data, indptr, cols, shape = self.cards_to_cards_sparse(chunk)
                arr = sparse.csr_matrix((data, indptr, cols), shape)
                assert (arr == chunk.values).all()
                self.card_data.append(arr)
                print(f"Processed chunk {i+1}/{n_chunks}.")
            self.noncard_data = pd.concat(self.noncard_data)
            self.card_data = sparse.vstack(self.card_data)
            self.card_data = self.card_data.tocsc()
            self.noncard_data.to_csv(self.cached_noncard_data, index=False)
            print(f"Wrote non-card data to {self.cached_noncard_data}.")
            with open(self.cached_card_data, "wb") as file:
                pickle.dump(self.card_data, file)
            print(f"Wrote card data to {self.cached_card_data}.")
        elif self.is_loaded:
            return self.noncard_data, self.card_data
        else:
            is_written = os.path.exists(self.cached_noncard_data) and os.path.exists(
                self.cached_card_data
            )
            if is_written:
                self.noncard_data = pd.read_csv(self.cached_noncard_data)
                with open(self.cached_card_data, "rb") as file:
                    self.card_data = pickle.load(file)
            else:  # user does not know what they are doing...
                return self.get_data(force_refresh=True)
        res = {"noncard_data": self.noncard_data, "card_data": self.card_data}
        return res


## Replay Data

CATEGORY_TO_PATTERN = {
    "deck": r"^deck_(.+)",
    "sideboard": r"^sideboard_(.+)",
    "turn": r"^(.*)_turn_(\d+)_(.*)$",
}


class ReplayDataBaseReader(MTGReader):
    def __init__(
        self,
        set_code,
        limited_type,
        dat_path=DEFAULT_DATA_DIR,
        chunk_size=10000,
    ):
        super().__init__(set_code, limited_type, "replay_data", dat_path)
        self.chunk_size = chunk_size

    @staticmethod
    def split_column_to_info(col):
        for cat, pat in CATEGORY_TO_PATTERN.items():
            m = re.match(pat, col)
            if m:
                if cat in ["deck", "sideboard"]:
                    return cat, m.group(1)
                elif cat == "turn":
                    return cat, (m.group(1), m.group(2), m.group(3))
        else:
            return "meta", col

    def set_column_meta(self, header):

        self.deck_d = dict()
        self.side_d = dict()
        self.turn_d = dict()
        self.meta_d = dict()

        # Loop Over Columns
        for i, c in enumerate(header):
            cat, parts = self.split_column_to_info(c)
            if cat in ["deck", "sideboard"]:  # key is just card name
                out_d = self.deck_d
                if cat == "sideboard":
                    out_d = self.side_d
                k = parts
            elif cat == "turn":  # key is (player, turn number, "thing" tallied)
                out_d = self.turn_d
                play, turn, acts = parts
                turn = int(turn)
                k = (play, turn, acts)
            else:  # key is full column name
                assert cat == "meta"
                out_d = self.meta_d
                k = c  # or parts
            # Assign
            out_d[k] = i

        ## Check and Return

        assert len(self.turn_d) + len(self.meta_d) + len(self.deck_d) + len(
            self.side_d
        ) == len(header), "Incorrectly categorized columns!"

        return

    def get_indices(
        self, deck_fields=None, meta_fields=None, side_fields=None, turn_fields=None
    ):
        assert deck_fields is None, "Unsupported `deck_fields` argument!"
        assert isinstance(meta_fields, list), "Unsupported `meta_fields` argument!"
        assert side_fields is None, "Unsupported `side_fields` argument!"
        assert isinstance(turn_fields, list), "Unsupported `turn_fields` argument!"
        ci = []
        ls = []
        for f in meta_fields:
            ci.append(self.meta_d[f])
            ls.append(f)
        if len(turn_fields) > 0:
            for (p, t, f), v in self.turn_d.items():
                if f in turn_fields:
                    ci.append(v)
                    ls.append((p, t, f))
        res = {"indices": ci, "labels": ls}
        if len(ci) == 1:
            return {k: v[0] for k, v in res.items()}
        return res

    def get_fields(self, fields):
        wi = self.get_indices(meta_fields=["won"])["indices"]
        fi = self.get_indices(turn_fields=fields)["indices"]

        out = np.zeros((self.n_lines, len(fi) + 1))
        n_chunks = self.n_lines // self.chunk_size + 1

        r0 = -self.chunk_size
        r1 = 0
        for i, chunk in enumerate(self.read_iterator(self.chunk_size, dtypes=True)):
            r0 += self.chunk_size
            r1 += self.chunk_size
            out[r0:r1, 0] = chunk.iloc[:, wi].astype(int).values
            out[r0:r1, 1:] = (
                chunk.iloc[:, fi].replace(r"\.0\b", "", regex=True).astype(int).values
            )
            print(f"Processed chunk {i+1}/{n_chunks}.")
        return out
