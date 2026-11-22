// Урок 9: приёмник UART, кадр 8N1.
// Ждёт старт-бит, читает каждый бит в его середине, проверяет стоп-бит.
// Принятый байт — на data, а valid = 1 ровно на один такт («байт готов»).
module uart_rx #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk
    parameter integer BAUD   = 115_200      // скорость линии, бод
) (
    input  wire       clk,
    input  wire       rx,       // линия UART: чужой сигнал, в покое 1
    output reg  [7:0] data  = 8'd0,  // последний принятый байт
    output reg        valid = 1'b0   // 1 на один такт, когда байт принят
);
    localparam integer BIT_LAST  = CLK_HZ / BAUD - 1;       // 233: целый бит
    localparam integer HALF_LAST = CLK_HZ / BAUD / 2 - 1;   // 116: полбита

    // Синхронизатор из урока 6: линия приходит от другой микросхемы со своим тактом.
    // Начальное значение 1 — как у линии в покое.
    reg rx_meta = 1'b1, rx_sync = 1'b1;

    always @(posedge clk) begin
        rx_meta <= rx;
        rx_sync <= rx_meta;
    end

    localparam [1:0] S_IDLE  = 2'd0,    // ждём, когда линия упадёт в 0
                     S_START = 2'd1,    // полбита: дойти до середины старт-бита
                     S_DATA  = 2'd2,    // 8 бит: читать в середине каждого
                     S_STOP  = 2'd3;    // середина стоп-бита: должна быть 1

    reg [1:0] state = S_IDLE;
    reg [1:0] next;             // НЕ регистр: присваивается в always @(*)
    reg [7:0] div = 8'd0;       // таймер: 0..BIT_LAST
    reg [2:0] n   = 3'd0;       // номер бита данных: 0..7
    reg [7:0] sr  = 8'd0;       // сдвиговый регистр: биты входят слева

    wire half_end = (div == HALF_LAST);
    wire bit_end  = (div == BIT_LAST);

    // Блок 1 — комбинационный: куда идти.
    always @(*) begin
        next = state;
        case (state)
            S_IDLE:  if (!rx_sync) next = S_START;               // линия упала
            S_START: if (half_end) begin
                         if (!rx_sync) next = S_DATA;           // в середине всё ещё 0
                         else          next = S_IDLE;           // это была помеха
                     end
            S_DATA:  if (bit_end && n == 3'd7) next = S_STOP;
            S_STOP:  if (bit_end) next = S_IDLE;
            default: next = S_IDLE;
        endcase
    end

    // Блок 2 — тактовый.
    always @(posedge clk) begin
        state <= next;
        valid <= 1'b0;                          // по умолчанию — импульса нет

        if (next != state || bit_end) div <= 8'd0;
        else                          div <= div + 1'b1;

        if (state == S_IDLE)
            n <= 3'd0;

        if (state == S_DATA && bit_end) begin   // середина бита данных
            sr <= {rx_sync, sr[7:1]};           // новый бит — слева, младший уедет вправо
            n  <= n + 1'b1;
        end

        if (state == S_STOP && bit_end && rx_sync) begin   // стоп-бит = 1: кадр цел
            data  <= sr;
            valid <= 1'b1;
        end
    end
endmodule
