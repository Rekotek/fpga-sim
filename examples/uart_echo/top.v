// Ожидаемое поведение: каждый байт, принятый на выводе 70 (uart_rx), возвращается на вывод 69
// (uart_tx). Скорость 115 200 бод (делитель 234), кадр 8N1. Приёмник читает бит в его середине.
// Принятый байт ждёт передатчик в одном регистре: передача бита (234 такта) короче бита
// терминала (234,4 такта), поэтому при непрерывном вводе байты не теряются.
// Проверочное число: 256 разных байтов (0…255) возвращаются без потерь и в том же порядке.
module top (
    input  wire clk,
    input  wire uart_rx,
    output wire uart_tx
);
    localparam integer CLK_HZ  = 27_000_000;
    localparam integer BAUD    = 115_200;
    localparam integer BIT_DIV = CLK_HZ / BAUD;
    localparam [31:0]  HALF    = BIT_DIV / 2;
    localparam [31:0]  LAST    = BIT_DIV - 1;

    // Синхронизатор входа.
    reg [1:0] sync = 2'b11;
    wire      rx   = sync[1];
    always @(posedge clk) sync <= {sync[0], uart_rx};

    // Приёмник.
    reg       rx_busy = 0;
    reg [7:0] rx_div  = 0;
    reg [3:0] rx_idx  = 0;
    reg [7:0] rx_data = 0;
    reg       rx_done = 0;

    always @(posedge clk) begin
        rx_done <= 1'b0;
        if (!rx_busy) begin
            if (!rx) begin
                rx_busy <= 1'b1;
                rx_div  <= HALF[7:0];
                rx_idx  <= 0;
            end
        end else if (rx_div != 0) begin
            rx_div <= rx_div - 1'b1;
        end else begin
            rx_div <= LAST[7:0];
            if (rx_idx == 0) begin
                // Середина стартового бита: помеха короче половины бита приём не начинает.
                if (rx) rx_busy <= 1'b0;
                else rx_idx <= 4'd1;
            end else if (rx_idx == 9) begin
                rx_busy <= 1'b0;
                rx_done <= rx;
            end else begin
                rx_data <= {rx, rx_data[7:1]};
                rx_idx  <= rx_idx + 1'b1;
            end
        end
    end

    // Байт, который ждёт передатчик.
    reg       hold_full = 0;
    reg [7:0] hold_data = 0;

    // Передатчик.
    reg       tx_busy = 0;
    reg [7:0] tx_div  = 0;
    reg [3:0] tx_idx  = 0;
    reg [7:0] tx_data = 0;
    reg       tx      = 1;

    always @(posedge clk) begin
        if (rx_done) begin
            hold_full <= 1'b1;
            hold_data <= rx_data;
        end
        if (!tx_busy) begin
            tx <= 1'b1;
            if (hold_full) begin
                tx_busy   <= 1'b1;
                tx_data   <= hold_data;
                tx_div    <= 0;
                tx_idx    <= 0;
                hold_full <= rx_done;
            end
        end else begin
            if (tx_div == 0) begin
                if (tx_idx == 0) tx <= 1'b0;
                else if (tx_idx == 9) tx <= 1'b1;
                else tx <= tx_data[tx_idx - 1];
            end
            if (tx_div == BIT_DIV - 1) begin
                tx_div <= 0;
                if (tx_idx == 9) tx_busy <= 1'b0;
                else tx_idx <= tx_idx + 1'b1;
            end else begin
                tx_div <= tx_div + 1'b1;
            end
        end
    end

    assign uart_tx = tx;
endmodule
